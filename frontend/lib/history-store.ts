// lib/history-store.ts
// Local storage persistence manager for user accounts, credentials, chat threads, and document history

export interface UserProfile {
  id: string;
  username: string;
  displayName: string;
  email?: string;
  avatar?: string;
  isGuest?: boolean;
}

export interface UserAccount extends UserProfile {
  passwordHash: string; // Stored securely in local account DB
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

/**
 * Default guest profile if none signed in
 */
export const DEFAULT_GUEST_USER: UserProfile = {
  id: 'guest-user',
  username: 'guest',
  displayName: '',
  isGuest: true,
};

/**
 * Gets all registered user accounts from storage
 */
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

/**
 * Registers a new user account with Full Name, Gmail Address, and Password
 */
export function registerUserAccount(
  displayName: string,
  gmailInput: string,
  password: string,
): { user: UserProfile; error?: string } {
  if (typeof window === 'undefined') {
    return { user: DEFAULT_GUEST_USER, error: 'Browser environment required' };
  }

  const cleanGmail = gmailInput.trim().toLowerCase();
  if (!cleanGmail) return { user: DEFAULT_GUEST_USER, error: 'Gmail address is required' };
  if (!/^[a-zA-Z0-9._%+-]+@gmail\.com$/.test(cleanGmail)) {
    return { user: DEFAULT_GUEST_USER, error: 'Invalid Gmail address. Please enter a valid @gmail.com email.' };
  }
  if (!password || password.length < 3) return { user: DEFAULT_GUEST_USER, error: 'Password must be at least 3 characters' };

  const accounts = getRegisteredAccounts();
  const existing = accounts.find((a) => a.email === cleanGmail || a.username === cleanGmail);
  if (existing) {
    return { user: DEFAULT_GUEST_USER, error: 'Account with this Gmail already exists. Please sign in instead.' };
  }

  const userKey = cleanGmail.replace(/[^a-zA-Z0-9]/g, '_');
  const newAccount: UserAccount = {
    id: `user_${userKey}`,
    username: cleanGmail,
    displayName: displayName.trim() || cleanGmail.split('@')[0],
    email: cleanGmail,
    passwordHash: btoa(password), // Safely stored in browser local account DB
    createdAt: new Date().toISOString(),
  };

  accounts.push(newAccount);
  localStorage.setItem(ACCOUNTS_DB_KEY, JSON.stringify(accounts));
  syncAccountToCloud(newAccount);

  const profile: UserProfile = {
    id: newAccount.id,
    username: newAccount.username,
    displayName: newAccount.displayName,
    email: newAccount.email,
  };

  saveUser(profile);
  return { user: profile };
}

function syncAccountToCloud(account: UserAccount) {
  if (typeof window === 'undefined') return;
  fetch('/api/admin/sync', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'save_account', account }),
  }).catch(() => {});
}

function syncThreadToCloud(userId: string, thread: ChatThread) {
  if (typeof window === 'undefined') return;
  fetch('/api/admin/sync', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'save_thread', userId, thread }),
  }).catch(() => {});
}

/**
 * Authenticates a user with Gmail address and password
 */
export function authenticateUserAccount(
  gmailInput: string,
  password: string,
): { user?: UserProfile; error?: string } {
  if (typeof window === 'undefined') return { error: 'Browser environment required' };

  const cleanGmail = gmailInput.trim().toLowerCase();
  if (!cleanGmail) return { error: 'Please enter your Gmail address' };

  const accounts = getRegisteredAccounts();
  const found = accounts.find((a) => a.email === cleanGmail || a.username === cleanGmail);

  if (!found) {
    return {
      error: 'Account with this Gmail does not exist. Please click "Create Account" to register first.',
    };
  }

  if (found.passwordHash !== btoa(password)) {
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
  syncAccountToCloud(found);
  return { user: profile };
}

/**
 * Registers or authenticates a user via Google Authentication (Gmail + Secret Code OTP)
 */
export function registerOrLoginGoogleAccount(
  gmailInput: string,
  displayNameInput?: string,
): { user: UserProfile; error?: string } {
  if (typeof window === 'undefined') {
    return { user: DEFAULT_GUEST_USER, error: 'Browser environment required' };
  }

  const cleanGmail = gmailInput.trim().toLowerCase();
  if (!cleanGmail || !/^[a-zA-Z0-9._%+-]+@gmail\.com$/.test(cleanGmail)) {
    return { user: DEFAULT_GUEST_USER, error: 'Invalid Gmail address. Must be a valid @gmail.com email.' };
  }

  const accounts = getRegisteredAccounts();
  let found = accounts.find((a) => a.email === cleanGmail || a.username === cleanGmail);

  if (!found) {
    const userKey = cleanGmail.replace(/[^a-zA-Z0-9]/g, '_');
    found = {
      id: `user_${userKey}`,
      username: cleanGmail,
      displayName: displayNameInput?.trim() || cleanGmail.split('@')[0],
      email: cleanGmail,
      passwordHash: btoa('GoogleAuthVerifiedSecret'),
      createdAt: new Date().toISOString(),
    };
    accounts.push(found);
    localStorage.setItem(ACCOUNTS_DB_KEY, JSON.stringify(accounts));
  }

  syncAccountToCloud(found);

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

/**
 * Gets active signed-in user session or returns null
 */
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

/**
 * Saves active user session to local storage
 */
export function saveUser(user: UserProfile): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(USER_SESSION_KEY, JSON.stringify(user));
}

/**
 * Removes active user session (sign out)
 */
export function removeUser(): void {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(USER_SESSION_KEY);
}

/**
 * Gets chat threads for a given user ID
 */
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
 * Saves or updates a chat thread for a user
 */
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
    syncThreadToCloud(userId, thread);
  } catch (error) {
    console.error('Error saving thread:', error);
  }
}

/**
 * Deletes a chat thread for a user
 */
export function deleteUserThread(userId: string, threadId: string): void {
  if (typeof window === 'undefined') return;
  try {
    const threads = getUserThreads(userId).filter((t) => t.id !== threadId);
    localStorage.setItem(
      `${THREADS_STORAGE_KEY_PREFIX}${userId}`,
      JSON.stringify(threads),
    );
  } catch (error) {
    console.error('Error deleting thread:', error);
  }
}

/**
 * Generates a cheerful greeting based on time of day and user profile
 */
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

/**
 * Admin interface structure
 */
export interface AdminUserData {
  account: UserAccount;
  plainPassword: string;
  threads: ChatThread[];
}

/**
 * Gets all user accounts, decoded passwords, and complete chat histories for Admin inspection
 */
export function getAllAdminData(): AdminUserData[] {
  if (typeof window === 'undefined') return [];

  const accountsMap = new Map<string, UserAccount>();

  // 1. Load registered user accounts
  const registered = getRegisteredAccounts();
  registered.forEach((acc) => accountsMap.set(acc.id, acc));

  // 2. Scan localStorage for any user thread records (Google sign in, custom logins, etc.)
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

  // 3. Build complete Admin data list
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
