// lib/fuzzy-entity-resolution.ts
// Ultra-Robust TOKEN-LEVEL Phonetic + String Distance + Recency Contact Entity Resolution Engine
// HARD CONSTRAINT: Only returns contacts from the REAL source contact list passed in. NEVER hallucinates names.

import { Contact, getSavedContacts } from './contacts-store';

/**
 * Metaphone Phonetic Encoding Algorithm
 * Encodes words based on how they SOUND in English.
 */
export function metaphone(word: string): string {
  if (!word) return '';
  let str = word.toUpperCase().replace(/[^A-Z]/g, '');
  if (!str) return '';

  if (str.startsWith('PN') || str.startsWith('KN') || str.startsWith('GN') || str.startsWith('AE') || str.startsWith('WR')) {
    str = str.substring(1);
  } else if (str.startsWith('X')) {
    str = 'S' + str.substring(1);
  } else if (str.startsWith('WH')) {
    str = 'W' + str.substring(2);
  }

  let code = '';
  let i = 0;
  const len = str.length;

  while (i < len && code.length < 6) {
    const char = str[i];
    const prev = i > 0 ? str[i - 1] : '';
    const next = i + 1 < len ? str[i + 1] : '';
    const nextNext = i + 2 < len ? str[i + 2] : '';

    if (char === prev && char !== 'C') { i++; continue; }

    switch (char) {
      case 'A': case 'E': case 'I': case 'O': case 'U':
        if (i === 0) code += char; break;
      case 'B': if (prev !== 'M') code += 'B'; break;
      case 'C':
        if (next === 'H') { code += 'X'; i++; }
        else if ('IEY'.includes(next)) code += 'S';
        else code += 'K';
        break;
      case 'D':
        if (next === 'G' && 'IEY'.includes(nextNext)) { code += 'J'; i += 2; }
        else code += 'T';
        break;
      case 'F': case 'J': case 'L': case 'M': case 'N': case 'R': code += char; break;
      case 'G':
        if (next === 'H' && i > 0) { /* silent */ }
        else if (next === 'N') { /* silent */ }
        else if ('IEY'.includes(next) && prev !== 'G') code += 'J';
        else code += 'K';
        break;
      case 'H': if ('AEIOU'.includes(next) && !'CSPTG'.includes(prev)) code += 'H'; break;
      case 'K': if (prev !== 'C') code += 'K'; break;
      case 'P': if (next === 'H') { code += 'F'; i++; } else code += 'P'; break;
      case 'Q': code += 'K'; break;
      case 'S':
        if (next === 'H') { code += 'X'; i++; }
        else if (next === 'I' && (nextNext === 'A' || nextNext === 'O')) code += 'X';
        else code += 'S';
        break;
      case 'T':
        if (next === 'H') { code += '0'; i++; }
        else if (next === 'I' && (nextNext === 'A' || nextNext === 'O')) code += 'X';
        else code += 'T';
        break;
      case 'V': code += 'F'; break;
      case 'W': case 'Y': if ('AEIOU'.includes(next)) code += char; break;
      case 'X': code += 'KS'; break;
      case 'Z': code += 'S'; break;
    }
    i++;
  }
  return code;
}

/**
 * Soundex Phonetic Encoder
 */
export function soundex(word: string): string {
  if (!word) return '0000';
  const a = word.toUpperCase().replace(/[^A-Z]/g, '');
  if (!a) return '0000';
  const codes: Record<string, string> = {
    B: '1', F: '1', P: '1', V: '1',
    C: '2', G: '2', J: '2', K: '2', Q: '2', S: '2', X: '2', Z: '2',
    D: '3', T: '3', L: '4', M: '5', N: '5', R: '6',
  };
  const first = a[0];
  let res = first;
  let prevCode = codes[first] || '';
  for (let i = 1; i < a.length && res.length < 4; i++) {
    const code = codes[a[i]];
    if (code && code !== prevCode) { res += code; prevCode = code; }
    else if (!code) prevCode = '';
  }
  while (res.length < 4) res += '0';
  return res;
}

/**
 * Jaro-Winkler String Distance Metric (0 to 1)
 */
export function jaroWinkler(s1: string, s2: string): number {
  const str1 = s1.toLowerCase().trim();
  const str2 = s2.toLowerCase().trim();
  if (str1 === str2) return 1.0;
  const len1 = str1.length;
  const len2 = str2.length;
  if (len1 === 0 || len2 === 0) return 0.0;
  const matchWindow = Math.floor(Math.max(len1, len2) / 2) - 1;
  const matches1 = new Array(len1).fill(false);
  const matches2 = new Array(len2).fill(false);
  let matches = 0;
  let transpositions = 0;
  for (let i = 0; i < len1; i++) {
    const start = Math.max(0, i - matchWindow);
    const end = Math.min(i + matchWindow + 1, len2);
    for (let j = start; j < end; j++) {
      if (matches2[j]) continue;
      if (str1[i] !== str2[j]) continue;
      matches1[i] = true; matches2[j] = true; matches++; break;
    }
  }
  if (matches === 0) return 0.0;
  let k = 0;
  for (let i = 0; i < len1; i++) {
    if (!matches1[i]) continue;
    while (!matches2[k]) k++;
    if (str1[i] !== str2[k]) transpositions++;
    k++;
  }
  const jaro = (matches / len1 + matches / len2 + (matches - transpositions / 2) / matches) / 3;
  let p = 0;
  const maxPrefix = Math.min(4, Math.min(len1, len2));
  for (let i = 0; i < maxPrefix; i++) { if (str1[i] === str2[i]) p++; else break; }
  return jaro + p * 0.1 * (1 - jaro);
}

/**
 * Levenshtein Distance
 */
export function levenshteinDistance(a: string, b: string): number {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  const matrix: number[][] = [];
  for (let i = 0; i <= b.length; i++) matrix[i] = [i];
  for (let j = 0; j <= a.length; j++) matrix[0][j] = j;
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) matrix[i][j] = matrix[i - 1][j - 1];
      else matrix[i][j] = Math.min(matrix[i - 1][j - 1] + 1, matrix[i][j - 1] + 1, matrix[i - 1][j] + 1);
    }
  }
  return matrix[b.length][a.length];
}

export interface ContactMatchScore {
  contact: Contact;
  score: number;
  phoneticMatch: boolean;
  stringSimilarity: number;
  reason: string;
}

export interface ContactResolutionResult {
  status: 'RESOLVED' | 'DISAMBIGUATE' | 'NOT_FOUND';
  resolvedContact?: Contact;
  candidates?: Contact[];
  confidence: number;
  clarifyingQuestion?: string;
  searchedName: string;
}

/**
 * TOKEN-LEVEL Multi-Pass Phonetic + String Similarity + Recency Contact Resolver
 *
 * KEY DESIGN: Tokenizes BOTH the query AND the contact name, then matches
 * any query token against ANY token in the contact name. This means
 * "Thanoj" will match "Thanoj friend CAI" because "Thanoj" is a token.
 *
 * HARD CONSTRAINT: Only returns contacts from the actual source list.
 * resolvedContact is ALWAYS a reference to an object from availableContacts.
 */
export function resolveContactEntity(rawNameQuery: string, availableContacts?: Contact[]): ContactResolutionResult {
  const contacts = availableContacts || getSavedContacts();
  const searchedName = rawNameQuery.trim();

  if (!searchedName || contacts.length === 0) {
    return { status: 'NOT_FOUND', confidence: 0, searchedName };
  }

  const queryLower = searchedName.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();
  const queryWords = queryLower.split(/\s+/).filter(w => w.length > 0);
  const queryMetaphones = queryWords.map(w => metaphone(w));
  const querySoundexes = queryWords.map(w => soundex(w));

  const scored: ContactMatchScore[] = contacts.map(contact => {
    const nameLower = contact.name.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();
    const nameWords = nameLower.split(/\s+/).filter(w => w.length > 0);
    const nameMetaphones = nameWords.map(w => metaphone(w));
    const nameSoundexes = nameWords.map(w => soundex(w));

    let score = 0;
    let phoneticMatch = false;
    let stringSim = 0;
    let reason = '';

    // ── PASS 1: Exact full-name match ──
    if (nameLower === queryLower) {
      score = 100; reason = 'Exact full match';
    }
    // ── PASS 2: Full-name prefix/contains ──
    else if (nameLower.startsWith(queryLower) || queryLower.startsWith(nameLower)) {
      score = 93; reason = 'Prefix match';
    }
    // ── PASS 3: TOKEN-LEVEL exact match ("Thanoj" matches token in "Thanoj friend CAI") ──
    else {
      let exactTokenMatches = 0;
      for (const qw of queryWords) {
        if (nameWords.includes(qw)) exactTokenMatches++;
      }
      if (exactTokenMatches > 0) {
        score = 88 + Math.min(7, exactTokenMatches * 3);
        reason = `Token exact match (${exactTokenMatches} token${exactTokenMatches > 1 ? 's' : ''})`;
      }
    }

    // ── PASS 4: TOKEN-LEVEL substring match ("Than" matches "Thanoj" token) ──
    if (score === 0) {
      let substringHits = 0;
      for (const qw of queryWords) {
        for (const nw of nameWords) {
          if (nw.includes(qw) || qw.includes(nw)) { substringHits++; break; }
        }
      }
      if (substringHits > 0) {
        score = 78 + Math.min(7, substringHits * 3);
        reason = `Token substring match`;
      }
    }

    // ── PASS 5: TOKEN-LEVEL Phonetic Matching (Metaphone + Soundex) ──
    if (score === 0 || score < 80) {
      let maxPhoneticScore = 0;
      for (let qi = 0; qi < queryWords.length; qi++) {
        const qMeta = queryMetaphones[qi];
        const qSnd = querySoundexes[qi];

        for (let ni = 0; ni < nameWords.length; ni++) {
          const nMeta = nameMetaphones[ni];
          const nSnd = nameSoundexes[ni];

          // Metaphone exact or 3-char prefix match
          if (qMeta && nMeta && (qMeta === nMeta || qMeta.slice(0, 3) === nMeta.slice(0, 3))) {
            maxPhoneticScore = Math.max(maxPhoneticScore, 82);
            phoneticMatch = true;
          }
          // Soundex match
          else if (qSnd && nSnd && qSnd === nSnd) {
            maxPhoneticScore = Math.max(maxPhoneticScore, 75);
            phoneticMatch = true;
          }
          // Near-phonetic Jaro-Winkler on phonetic codes
          else if (qMeta && nMeta && jaroWinkler(qMeta, nMeta) >= 0.75) {
            maxPhoneticScore = Math.max(maxPhoneticScore, 78);
            phoneticMatch = true;
          }
        }
      }
      if (maxPhoneticScore > score) {
        score = maxPhoneticScore;
        reason = 'Phonetic token match';
      }
    }

    // ── PASS 6: TOKEN-LEVEL Jaro-Winkler & Levenshtein String Similarity ──
    let maxTokenSim = 0;
    for (const qw of queryWords) {
      for (const nw of nameWords) {
        const jw = jaroWinkler(qw, nw);
        const levDist = levenshteinDistance(qw, nw);
        const levSim = 1 - (levDist / Math.max(qw.length, nw.length, 1));
        const sim = Math.max(jw, levSim);
        if (sim > maxTokenSim) maxTokenSim = sim;
      }
    }
    stringSim = maxTokenSim;

    if (score === 0 && stringSim >= 0.7) {
      score = Math.round(stringSim * 80);
      reason = `String similarity (${Math.round(stringSim * 100)}%)`;
    }

    // ── PASS 7: Recency / Frequency Bias ──
    const interactionCount = (contact as any).interactionCount || 0;
    if (interactionCount > 0 && score > 30) {
      const boost = Math.min(10, interactionCount * 2);
      score += boost;
      reason += ` (+${boost} freq)`;
    }

    return {
      contact,
      score: Math.min(100, score),
      phoneticMatch,
      stringSimilarity: stringSim,
      reason,
    };
  });

  const validMatches = scored.filter(s => s.score >= 45).sort((a, b) => b.score - a.score);

  if (validMatches.length === 0) {
    return { status: 'NOT_FOUND', confidence: 0, searchedName };
  }

  const topMatch = validMatches[0];
  const secondMatch = validMatches.length > 1 ? validMatches[1] : null;

  // STRICT POST-CHECK: Verify topMatch.contact is actually from our source list
  const verified = contacts.find(c => c.id === topMatch.contact.id);
  if (!verified) {
    return { status: 'NOT_FOUND', confidence: 0, searchedName };
  }

  // Multiple close matches → DISAMBIGUATE (show all options)
  if (secondMatch && (topMatch.score - secondMatch.score) < 12 && secondMatch.score >= 50) {
    const candidates = validMatches.slice(0, 5).map(m => m.contact);
    const nameList = candidates.map((c, i) => `${i + 1}. ${c.name}`).join(', ');
    return {
      status: 'DISAMBIGUATE',
      candidates,
      confidence: topMatch.score,
      clarifyingQuestion: `I found ${candidates.length} matches: ${nameList}. Which one?`,
      searchedName,
    };
  }

  // High confidence single match
  if (topMatch.score >= 70) {
    return {
      status: 'RESOLVED',
      resolvedContact: topMatch.contact,
      confidence: topMatch.score,
      candidates: [topMatch.contact],
      searchedName,
    };
  }

  // Medium confidence → Disambiguate with single candidate confirmation
  return {
    status: 'DISAMBIGUATE',
    resolvedContact: topMatch.contact,
    candidates: validMatches.slice(0, 3).map(m => m.contact),
    confidence: topMatch.score,
    clarifyingQuestion: `Did you mean ${topMatch.contact.name}?`,
    searchedName,
  };
}
