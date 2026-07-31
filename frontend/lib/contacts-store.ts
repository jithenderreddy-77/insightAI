// lib/contacts-store.ts
// Local contact store for voice assistant smart dialing with fuzzy search & device contacts sync

export interface Contact {
  id: string;
  name: string;
  phone: string;
  email?: string;
  label?: string; // e.g. "Work", "Home", "Mobile", "WhatsApp"
}

const CONTACTS_STORAGE_KEY = 'insight_user_contacts';

// Default initial contact list so voice calling works immediately out of the box
const DEFAULT_CONTACTS: Contact[] = [
  { id: 'c_1', name: 'Thanoj Reddy', phone: '+15550192834', label: 'Mobile' },
  { id: 'c_2', name: 'Thanoj Work', phone: '+15550199999', label: 'Work' },
  { id: 'c_3', name: 'Rahul Sharma', phone: '+15550183746', label: 'Mobile' },
  { id: 'c_4', name: 'Priya Patel', phone: '+15550172635', label: 'Mobile' },
  { id: 'c_5', name: 'Alex Johnson', phone: '+15550164532', label: 'Work' },
  { id: 'c_6', name: 'Mom', phone: '+15550153421', label: 'Home' },
  { id: 'c_7', name: 'Dad', phone: '+15550142310', label: 'Home' },
];

/**
 * Get all saved contacts from localStorage (with auto-initialization of defaults)
 */
export function getSavedContacts(): Contact[] {
  if (typeof window === 'undefined') return DEFAULT_CONTACTS;
  try {
    const raw = localStorage.getItem(CONTACTS_STORAGE_KEY);
    if (!raw) {
      localStorage.setItem(CONTACTS_STORAGE_KEY, JSON.stringify(DEFAULT_CONTACTS));
      return DEFAULT_CONTACTS;
    }
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.length > 0 ? parsed : DEFAULT_CONTACTS;
  } catch {
    return DEFAULT_CONTACTS;
  }
}

/**
 * Save contacts to localStorage
 */
export function saveContacts(contacts: Contact[]): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(CONTACTS_STORAGE_KEY, JSON.stringify(contacts));
}

/**
 * Add or update a single contact
 */
export function upsertContact(contact: Contact): void {
  const contacts = getSavedContacts();
  const idx = contacts.findIndex((c) => c.id === contact.id || (c.name.toLowerCase() === contact.name.toLowerCase() && c.phone === contact.phone));
  if (idx >= 0) {
    contacts[idx] = { ...contacts[idx], ...contact };
  } else {
    contacts.push(contact);
  }
  saveContacts(contacts);
}

/**
 * Remove a contact by ID
 */
export function removeContact(id: string): void {
  const contacts = getSavedContacts().filter((c) => c.id !== id);
  saveContacts(contacts);
}

/**
 * Levenshtein distance for fuzzy string matching
 */
function editDistance(a: string, b: string): number {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  const matrix: number[][] = [];
  for (let i = 0; i <= b.length; i++) matrix[i] = [i];
  for (let j = 0; j <= a.length; j++) matrix[0][j] = j;

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1, // substitution
          matrix[i][j - 1] + 1,     // insertion
          matrix[i - 1][j] + 1      // deletion
        );
      }
    }
  }

  return matrix[b.length][a.length];
}

/**
 * Ultra-Robust Multi-Pass Fuzzy Contact Search
 * Matches full names, partial words, nicknames, prefix matches, and sound-alike/typo variations.
 */
export function searchContacts(query: string): Contact[] {
  if (!query || query.trim().length < 1) return [];
  const contacts = getSavedContacts();
  const cleanQuery = query.toLowerCase().trim();
  const searchWords = cleanQuery.split(/\s+/).filter((w) => w.length > 0);

  const scored = contacts
    .map((contact) => {
      const nameLower = contact.name.toLowerCase().trim();
      const labelLower = (contact.label || '').toLowerCase().trim();
      const nameWords = nameLower.split(/\s+/);

      // Pass 1: Exact full match
      if (nameLower === cleanQuery) {
        return { contact, score: 100 };
      }

      // Pass 2: Name starts with query or query starts with name
      if (nameLower.startsWith(cleanQuery) || cleanQuery.startsWith(nameLower)) {
        return { contact, score: 90 };
      }

      // Pass 3: Any word in query matches any word in contact name exactly
      const wordMatchCount = searchWords.filter((sw) => nameWords.some((nw) => nw === sw)).length;
      if (wordMatchCount > 0) {
        return { contact, score: 80 + wordMatchCount * 5 };
      }

      // Pass 4: Substring match (e.g. "than" matches "Thanoj")
      const substringMatch = searchWords.every((sw) => nameLower.includes(sw));
      if (substringMatch) {
        return { contact, score: 70 };
      }

      // Pass 5: Prefix match on any word (e.g. "thano" matches "Thanoj")
      const prefixMatch = searchWords.some((sw) => nameWords.some((nw) => nw.startsWith(sw) || sw.startsWith(nw)));
      if (prefixMatch) {
        return { contact, score: 60 };
      }

      // Pass 6: Fuzzy Edit Distance for typos/nicknames (e.g. "Thanoj" vs "Thanojj" or "Thanu")
      let minDistance = 999;
      for (const nw of nameWords) {
        for (const sw of searchWords) {
          const dist = editDistance(sw, nw);
          if (dist < minDistance) minDistance = dist;
        }
      }

      if (minDistance <= 2) {
        return { contact, score: 50 - minDistance * 10 };
      }

      // Pass 7: Label/Category match
      if (searchWords.some((sw) => labelLower.includes(sw))) {
        return { contact, score: 40 };
      }

      return { contact, score: 0 };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score);

  return scored.map((item) => item.contact);
}

/**
 * Sync device contacts using the Web Contact Picker API (Chrome Android 80+ / iOS Safari with permissions).
 */
export async function syncDeviceContacts(): Promise<Contact[]> {
  if (typeof window === 'undefined') return [];

  const nav = navigator as any;
  if (!('contacts' in nav) || !('ContactsManager' in window)) {
    return getSavedContacts();
  }

  try {
    const properties = ['name', 'tel', 'email'];
    const opts = { multiple: true };
    const deviceContacts = await nav.contacts.select(properties, opts);

    const synced: Contact[] = [];
    for (const dc of deviceContacts) {
      const name = dc.name?.[0] || 'Unknown';
      const phone = dc.tel?.[0] || '';
      const email = dc.email?.[0] || '';

      if (phone) {
        synced.push({
          id: `device_${phone.replace(/\D/g, '')}`,
          name,
          phone,
          email: email || undefined,
          label: 'Mobile',
        });
      }
    }

    if (synced.length > 0) {
      const existing = getSavedContacts();
      for (const sc of synced) {
        if (!existing.some((e) => e.phone.replace(/\D/g, '') === sc.phone.replace(/\D/g, ''))) {
          existing.push(sc);
        }
      }
      saveContacts(existing);
    }
    return getSavedContacts();
  } catch {
    return getSavedContacts();
  }
}
