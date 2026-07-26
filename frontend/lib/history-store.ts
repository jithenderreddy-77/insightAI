// lib/history-store.ts
// Persistent storage manager — Supabase DB is the SOURCE OF TRUTH.
// localStorage is a local cache only. All auth & data survives redeployments.

export interface UserProfile {
  id: string;
  username: string;
  displayName: string;
  email?: string;
  avatar?: string;
  isGuest?: boolean;
}

export interface UserAccount extends UserProfile {
  passwordHash: string;
  createdAt: string;
}

export interface StoredMessage {
  role: 'user' | 'assistant';
  content: string;
  sources?: any[];
}

export interface ChatThread {
  id: string;
  title: string;
  messages: StoredMessage[];
  fileNames: string[];
  createdAt: string;
  updatedAt: string;
}

const USER_SESSION_KEY = 'insight_active_user_session';
const ACCOUNTS_DB_KEY = 'insight_registered_user_accounts';
const THREADS_STORAGE_KEY_PREFIX = 'insight_user_threads_';

export const DEFAULT_GUEST_USER: UserProfile = {
  id: 'guest-user',
  username: 'guest',
  displayName: '',
  isGuest: true,
};

// ─────────────────────────────────────────────────────────
// LOCAL CACHE HELPERS (localStorage)
// ─────────────────────────────────────────────────────────

export function getRegisteredAccounts(): UserAccount[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(ACCOUNTS_DB_KEY);
    if (!raw) return [];
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

function saveAccountToLocalCache(account: UserAccount) {
  if (typeof window === 'undefined') return;
  const accounts = getRegisteredAccounts();
  const idx = accounts.findIndex((a) => a.id === account.id || a.email === account.email);
  if (idx >= 0) {
    accounts[idx] = account;
  } else {
    accounts.push(account);
  }
  localStorage.setItem(ACCOUNTS_DB_KEY, JSON.stringify(accounts));
}

// ─────────────────────────────────────────────────────────
// SERVER API CALLS (Supabase = Source of Truth)
// ─────────────────────────────────────────────────────────

async function callAuthAPI(body: any): Promise<any> {
  try {
    const res = await fetch('/api/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return await res.json();
  } catch (err) {
    console.error('Auth API call failed:', err);
    return { success: false, error: 'Network error — operating in offline mode' };
  }
}

// ─────────────────────────────────────────────────────────
// REGISTER — Creates account in Supabase DB + local cache
// ─────────────────────────────────────────────────────────

export async function registerUserAccount(
  displayName: string,
  gmailInput: string,
  password: string,
): Promise<{ user: UserProfile; error?: string }> {
  if (typeof window === 'undefined') {
    return { user: DEFAULT_GUEST_USER, error: 'Browser environment required' };
  }

  const cleanGmail = gmailInput.trim().toLowerCase();
  if (!cleanGmail) return { user: DEFAULT_GUEST_USER, error: 'Gmail address is required' };
  if (!/^[a-zA-Z0-9._%+-]+@gmail\.com$/.test(cleanGmail)) {
    return { user: DEFAULT_GUEST_USER, error: 'Invalid Gmail address. Please enter a valid @gmail.com email.' };
  }
  if (!password || password.length < 3) return { user: DEFAULT_GUEST_USER, error: 'Password must be at least 3 characters' };

  const userKey = cleanGmail.replace(/[^a-zA-Z0-9]/g, '_');
  const newAccount: UserAccount = {
    id: `user_${userKey}`,
    username: cleanGmail,
    displayName: displayName.trim() || cleanGmail.split('@')[0],
    email: cleanGmail,
    passwordHash: btoa(password),
    createdAt: new Date().toISOString(),
  };

  // 1. Save to Supabase DB (source of truth)
  const dbResult = await callAuthAPI({
    action: 'register',
    ...newAccount,
  });

  if (dbResult.success === false && dbResult.error) {
    // If DB says account exists, check if local cache has it
    if (dbResult.error.includes('already exists')) {
      return { user: DEFAULT_GUEST_USER, error: dbResult.error };
    }
    // DB error but not "already exists" — fall through to local registration
  }

  // 2. Also save to local cache
  saveAccountToLocalCache(newAccount);

  const profile: UserProfile = {
    id: newAccount.id,
    username: newAccount.username,
    displayName: newAccount.displayName,
    email: newAccount.email,
  };

  saveUser(profile);
  return { user: profile };
}

// ─────────────────────────────────────────────────────────
// LOGIN — Authenticates from Supabase DB first, then local cache fallback
// ─────────────────────────────────────────────────────────

export async function authenticateUserAccount(
  gmailInput: string,
  password: string,
): Promise<{ user?: UserProfile; error?: string }> {
  if (typeof window === 'undefined') return { error: 'Browser environment required' };

  const cleanGmail = gmailInput.trim().toLowerCase();
  if (!cleanGmail) return { error: 'Please enter your Gmail address' };

  const passwordHash = btoa(password);

  // 1. Try Supabase DB first (source of truth — survives redeployments!)
  const dbResult = await callAuthAPI({
    action: 'login',
    email: cleanGmail,
    passwordHash,
  });

  if (dbResult.success && dbResult.account) {
    const acc = dbResult.account;
    const profile: UserProfile = {
      id: acc.id,
      username: acc.username,
      displayName: acc.displayName,
      email: acc.email,
      avatar: acc.avatar,
    };

    // Sync account to local cache so subsequent operations are fast
    saveAccountToLocalCache({
      id: acc.id,
      username: acc.username,
      displayName: acc.displayName,
      email: acc.email,
      avatar: acc.avatar,
      passwordHash: acc.passwordHash,
      createdAt: acc.createdAt,
    });

    saveUser(profile);

    // Also load user's cloud chat threads into local cache
    loadCloudThreadsToLocal(acc.id);

    return { user: profile };
  }

  // 2. Fallback to local cache if DB is unreachable
  if (dbResult.error === 'Network error — operating in offline mode') {
    const accounts = getRegisteredAccounts();
    const found = accounts.find((a) => a.email === cleanGmail || a.username === cleanGmail);
    if (!found) {
      return { error: 'Account not found. Please create an account first.' };
    }
    if (found.passwordHash !== passwordHash) {
      return { error: 'Incorrect password. Please try again.' };
    }
    const profile: UserProfile = {
      id: found.id,
      username: found.username,
      displayName: found.displayName,
      email: found.email,
      avatar: found.avatar,
    };
    saveUser(profile);
    return { user: profile };
  }

  return { error: dbResult.error || 'Authentication failed' };
}

// ─────────────────────────────────────────────────────────
// GOOGLE AUTH — Register or login via Google OTP-verified Gmail
// ─────────────────────────────────────────────────────────

export async function registerOrLoginGoogleAccount(
  gmailInput: string,
  displayNameInput?: string,
): Promise<{ user: UserProfile; error?: string }> {
  if (typeof window === 'undefined') {
    return { user: DEFAULT_GUEST_USER, error: 'Browser environment required' };
  }

  const cleanGmail = gmailInput.trim().toLowerCase();
  if (!cleanGmail || !/^[a-zA-Z0-9._%+-]+@gmail\.com$/.test(cleanGmail)) {
    return { user: DEFAULT_GUEST_USER, error: 'Invalid Gmail address.' };
  }

  const userKey = cleanGmail.replace(/[^a-zA-Z0-9]/g, '_');

  // 1. Register or login in Supabase DB
  const dbResult = await callAuthAPI({
    action: 'google_auth',
    id: `user_${userKey}`,
    email: cleanGmail,
    displayName: displayNameInput?.trim() || cleanGmail.split('@')[0],
    passwordHash: btoa('GoogleAuthVerifiedSecret'),
    createdAt: new Date().toISOString(),
  });

  let account: any;
  if (dbResult.success && dbResult.account) {
    account = dbResult.account;
  } else {
    // Fallback to local
    account = {
      id: `user_${userKey}`,
      username: cleanGmail,
      displayName: displayNameInput?.trim() || cleanGmail.split('@')[0],
      email: cleanGmail,
      passwordHash: btoa('GoogleAuthVerifiedSecret'),
      createdAt: new Date().toISOString(),
    };
  }

  // 2. Save to local cache
  saveAccountToLocalCache({
    id: account.id,
    username: account.username,
    displayName: account.displayName,
    email: account.email,
    passwordHash: account.passwordHash,
    createdAt: account.createdAt,
  });

  const profile: UserProfile = {
    id: account.id,
    username: account.username,
    displayName: account.displayName,
    email: account.email,
    avatar: account.avatar,
  };

  saveUser(profile);

  // Load cloud threads
  loadCloudThreadsToLocal(account.id);

  return { user: profile };
}

// ─────────────────────────────────────────────────────────
// SESSION MANAGEMENT
// ─────────────────────────────────────────────────────────

export function getSavedUser(): UserProfile | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(USER_SESSION_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function saveUser(user: UserProfile): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(USER_SESSION_KEY, JSON.stringify(user));
}

export function removeUser(): void {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(USER_SESSION_KEY);
}

// ─────────────────────────────────────────────────────────
// CHAT THREADS — Local cache + Supabase DB sync
// ─────────────────────────────────────────────────────────

export function getUserThreads(userId: string): ChatThread[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(`${THREADS_STORAGE_KEY_PREFIX}${userId}`);
    if (!raw) return [];
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

/**
 * Load threads from Supabase cloud DB into local cache (called on login)
 */
export async function loadCloudThreadsToLocal(userId: string): Promise<void> {
  if (typeof window === 'undefined') return;
  try {
    const dbResult = await callAuthAPI({ action: 'get_threads', userId });
    if (dbResult.success && dbResult.threads && dbResult.threads.length > 0) {
      const localThreads = getUserThreads(userId);
      const localIds = new Set(localThreads.map((t) => t.id));

      let merged = [...localThreads];
      dbResult.threads.forEach((cloudThread: ChatThread) => {
        if (!localIds.has(cloudThread.id)) {
          merged.push(cloudThread);
        } else {
          // Cloud version may be newer — update local
          const idx = merged.findIndex((t) => t.id === cloudThread.id);
          if (idx >= 0 && new Date(cloudThread.updatedAt) > new Date(merged[idx].updatedAt)) {
            merged[idx] = cloudThread;
          }
        }
      });

      // Sort by updatedAt descending
      merged.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

      localStorage.setItem(`${THREADS_STORAGE_KEY_PREFIX}${userId}`, JSON.stringify(merged));
    }
  } catch (err) {
    console.error('Failed to load cloud threads:', err);
  }
}

export function saveUserThread(userId: string, thread: ChatThread): void {
  if (typeof window === 'undefined') return;
  try {
    const threads = getUserThreads(userId);
    const existingIdx = threads.findIndex((t) => t.id === thread.id);
    if (existingIdx >= 0) {
      threads[existingIdx] = thread;
    } else {
      threads.unshift(thread);
    }
    localStorage.setItem(
      `${THREADS_STORAGE_KEY_PREFIX}${userId}`,
      JSON.stringify(threads),
    );

    // Sync to Supabase DB (source of truth backup)
    callAuthAPI({ action: 'save_thread', userId, thread }).catch(() => {});
  } catch (error) {
    console.error('Error saving thread:', error);
  }
}

export function deleteUserThread(userId: string, threadId: string): void {
  if (typeof window === 'undefined') return;
  try {
    const threads = getUserThreads(userId).filter((t) => t.id !== threadId);
    localStorage.setItem(
      `${THREADS_STORAGE_KEY_PREFIX}${userId}`,
      JSON.stringify(threads),
    );
    // Also delete from cloud DB
    callAuthAPI({ action: 'delete_thread', threadId }).catch(() => {});
  } catch (error) {
    console.error('Error deleting thread:', error);
  }
}

// ─────────────────────────────────────────────────────────
// GREETING
// ─────────────────────────────────────────────────────────

export function getCheerfulGreeting(displayName?: string, isGuest?: boolean): string {
  const hour = new Date().getHours();
  let timeOfDay = 'day';
  let emoji = '✨';

  if (hour >= 5 && hour < 12) {
    timeOfDay = 'morning';
    emoji = '🌅';
  } else if (hour >= 12 && hour < 17) {
    timeOfDay = 'afternoon';
    emoji = '☀️';
  } else if (hour >= 17 && hour < 22) {
    timeOfDay = 'evening';
    emoji = '🌆';
  } else {
    timeOfDay = 'night';
    emoji = '🌙';
  }
  const name = (displayName || '').trim();
  if (isGuest || !name || name.toLowerCase() === 'guest' || name.toLowerCase() === 'alex explorer') {
    return `Good ${timeOfDay}! ${emoji} Ready to extract intelligence from your documents?`;
  }

  const firstName = name.split(' ')[0] || name;
  return `Good ${timeOfDay}, ${firstName}! ${emoji} Ready to extract intelligence from your documents?`;
}

// ─────────────────────────────────────────────────────────
// ADMIN DATA — Fetches from Supabase DB (survives redeployments)
// ─────────────────────────────────────────────────────────

export interface AdminUserData {
  account: UserAccount;
  plainPassword: string;
  threads: ChatThread[];
}

export function getAllAdminData(): AdminUserData[] {
  if (typeof window === 'undefined') return [];

  const accountsMap = new Map<string, UserAccount>();

  // Load from local cache
  const registered = getRegisteredAccounts();
  registered.forEach((acc) => accountsMap.set(acc.id, acc));

  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && key.startsWith(THREADS_STORAGE_KEY_PREFIX)) {
      const userId = key.replace(THREADS_STORAGE_KEY_PREFIX, '');
      if (!accountsMap.has(userId)) {
        const cleanName = userId.replace('user_', '').replace('google_', '');
        accountsMap.set(userId, {
          id: userId,
          username: cleanName,
          displayName: cleanName.split('_').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' '),
          email: userId.includes('@') ? userId : `${cleanName}@gmail.com`,
          passwordHash: btoa('GoogleAuth/Pass'),
          createdAt: new Date().toISOString(),
        });
      }
    }
  }

  const result: AdminUserData[] = [];
  accountsMap.forEach((acc) => {
    let plainPassword = acc.passwordHash;
    try {
      plainPassword = atob(acc.passwordHash);
    } catch {}
    const threads = getUserThreads(acc.id);
    result.push({
      account: acc,
      plainPassword,
      threads,
    });
  });

  return result;
}

/**
 * Fetch ALL admin data from Supabase cloud DB (survives redeployments!)
 */
export async function getAllAdminDataFromCloud(): Promise<AdminUserData[]> {
  try {
    const dbResult = await callAuthAPI({ action: 'get_all_admin' });
    if (!dbResult.success) return [];

    const result: AdminUserData[] = [];
    const accounts = dbResult.accounts || [];
    const chats = dbResult.chats || [];

    accounts.forEach((acc: any) => {
      let plainPassword = acc.password_hash;
      try {
        plainPassword = atob(acc.password_hash);
      } catch {}

      const userChats = chats
        .filter((c: any) => c.user_id === acc.id)
        .map((c: any) => ({
          id: c.id,
          title: c.title,
          messages: c.messages,
          fileNames: c.file_names || [],
          createdAt: c.created_at,
          updatedAt: c.updated_at,
        }));

      result.push({
        account: {
          id: acc.id,
          username: acc.username,
          displayName: acc.display_name,
          email: acc.email,
          avatar: acc.avatar,
          passwordHash: acc.password_hash,
          createdAt: acc.created_at,
        },
        plainPassword,
        threads: userChats,
      });
    });

    return result;
  } catch (err) {
    console.error('Failed to fetch cloud admin data:', err);
    return [];
  }
}
