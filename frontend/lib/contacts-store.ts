// lib/contacts-store.ts
// Local contact store for voice assistant smart dialing with device contacts sync

export interface Contact {
  id: string;
  name: string;
  phone: string;
  email?: string;
  label?: string; // e.g. "Work", "Home", "Mobile"
}

const CONTACTS_STORAGE_KEY = 'insight_user_contacts';

/**
 * Get all saved contacts from localStorage
 */
export function getSavedContacts(): Contact[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(CONTACTS_STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw);
  } catch {
    return [];
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
  const idx = contacts.findIndex((c) => c.id === contact.id);
  if (idx >= 0) {
    contacts[idx] = contact;
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
 * Fuzzy search contacts by name.
 * Matches if any word in the search query appears anywhere in the contact name (case-insensitive).
 * Returns contacts sorted by relevance (exact match first, then partial).
 */
export function searchContacts(query: string): Contact[] {
  if (!query || query.trim().length < 2) return [];
  const contacts = getSavedContacts();
  const searchWords = query.toLowerCase().trim().split(/\s+/);

  const scored = contacts
    .map((contact) => {
      const nameLower = contact.name.toLowerCase();
      const labelLower = (contact.label || '').toLowerCase();

      // Exact full name match = highest score
      if (nameLower === query.toLowerCase().trim()) {
        return { contact, score: 100 };
      }

      // All search words found in name = very high score
      const allWordsMatch = searchWords.every((w) => nameLower.includes(w));
      if (allWordsMatch) {
        return { contact, score: 80 };
      }

      // Any search word found in name or label = partial match
      const anyWordMatch = searchWords.some((w) => nameLower.includes(w) || labelLower.includes(w));
      if (anyWordMatch) {
        return { contact, score: 40 };
      }

      return { contact, score: 0 };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score);

  return scored.map((item) => item.contact);
}

/**
 * Try to sync device contacts using the Web Contact Picker API (Chrome Android 80+).
 * Returns synced contacts or empty array if unsupported.
 * This is a one-shot picker — user selects which contacts to share.
 */
export async function syncDeviceContacts(): Promise<Contact[]> {
  if (typeof window === 'undefined') return [];

  const nav = navigator as any;
  if (!('contacts' in nav) || !('ContactsManager' in window)) {
    return [];
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
          label: 'Synced',
        });
      }
    }

    // Merge with existing contacts (don't overwrite user-added ones)
    const existing = getSavedContacts();
    for (const sc of synced) {
      if (!existing.some((e) => e.phone.replace(/\D/g, '') === sc.phone.replace(/\D/g, ''))) {
        existing.push(sc);
      }
    }
    saveContacts(existing);
    return synced;
  } catch {
    return [];
  }
}
