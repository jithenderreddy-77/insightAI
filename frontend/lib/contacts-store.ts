// lib/contacts-store.ts
// Local contact store for voice assistant smart dialing with fuzzy search & device contacts sync

import { resolveContactEntity } from './fuzzy-entity-resolution';

export interface Contact {
  id: string;
  name: string;
  phone: string;
  email?: string;
  label?: string; // e.g. "Work", "Home", "Mobile", "WhatsApp"
  interactionCount?: number;
  lastInteractedAt?: string;
}

const CONTACTS_STORAGE_KEY = 'insight_user_contacts';

// Default initial contact list so voice calling works immediately out of the box
const DEFAULT_CONTACTS: Contact[] = [
  { id: 'c_1', name: 'Thanoj Reddy', phone: '+15550192834', label: 'Mobile', interactionCount: 5 },
  { id: 'c_2', name: 'Thanoj Work', phone: '+15550199999', label: 'Work', interactionCount: 2 },
  { id: 'c_3', name: 'Rahul Sharma', phone: '+15550183746', label: 'Mobile', interactionCount: 1 },
  { id: 'c_4', name: 'Priya Patel', phone: '+15550172635', label: 'Mobile', interactionCount: 1 },
  { id: 'c_5', name: 'Alex Johnson', phone: '+15550164532', label: 'Work', interactionCount: 0 },
  { id: 'c_6', name: 'Mom', phone: '+15550153421', label: 'Home', interactionCount: 10 },
  { id: 'c_7', name: 'Dad', phone: '+15550142310', label: 'Home', interactionCount: 8 },
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
 * Record a contact interaction to boost frequency/recency ranking
 */
export function recordContactInteraction(contactId: string): void {
  const contacts = getSavedContacts();
  const idx = contacts.findIndex((c) => c.id === contactId);
  if (idx >= 0) {
    contacts[idx].interactionCount = (contacts[idx].interactionCount || 0) + 1;
    contacts[idx].lastInteractedAt = new Date().toISOString();
    saveContacts(contacts);
  }
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
 * Multi-Pass Phonetic + String Distance + Recency Contact Search
 * Uses Double Metaphone, Soundex, Jaro-Winkler, and Frequency Bias.
 */
export function searchContacts(query: string): Contact[] {
  if (!query || query.trim().length < 1) return [];
  const contacts = getSavedContacts();
  const resolution = resolveContactEntity(query, contacts);

  if (resolution.candidates && resolution.candidates.length > 0) {
    return resolution.candidates;
  }

  if (resolution.resolvedContact) {
    return [resolution.resolvedContact];
  }

  return [];
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
