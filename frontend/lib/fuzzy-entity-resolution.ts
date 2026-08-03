// lib/fuzzy-entity-resolution.ts
// Ultra-Robust Phonetic + String Distance + Recency Contact Entity Resolution Engine
// Resolves mispronunciations, STT transcription drift (e.g. "Thanos"/"Tanoj"/"Danoj" -> "Thanoj")

import { Contact, getSavedContacts } from './contacts-store';

/**
 * Metaphone Phonetic Encoding Algorithm
 * Encodes words based on how they SOUND in English.
 */
export function metaphone(word: string): string {
  if (!word) return '';
  let str = word.toUpperCase().replace(/[^A-Z]/g, '');
  if (!str) return '';

  // Handle initial letter exceptions
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

    // Skip duplicate adjacent letters (except C)
    if (char === prev && char !== 'C') {
      i++;
      continue;
    }

    switch (char) {
      case 'A':
      case 'E':
      case 'I':
      case 'O':
      case 'U':
        if (i === 0) code += char;
        break;
      case 'B':
        if (prev !== 'M') code += 'B';
        break;
      case 'C':
        if (next === 'H') {
          code += 'X';
          i++;
        } else if (next === 'I' || next === 'E' || next === 'Y') {
          code += 'S';
        } else {
          code += 'K';
        }
        break;
      case 'D':
        if (next === 'G' && ('IEY'.includes(nextNext))) {
          code += 'J';
          i += 2;
        } else if (next === 'T' || next === 'D') {
          code += 'T';
        } else {
          code += 'T';
        }
        break;
      case 'F':
      case 'J':
      case 'L':
      case 'M':
      case 'N':
      case 'R':
        code += char;
        break;
      case 'G':
        if (next === 'H' && i > 0) {
          // Silent GH
        } else if (next === 'N' || next === 'N' + 'S') {
          // Silent G
        } else if ('IEY'.includes(next) && prev !== 'G') {
          code += 'J';
        } else {
          code += 'K';
        }
        break;
      case 'H':
        if ('AEIOU'.includes(next) && !'CSPTG'.includes(prev)) {
          code += 'H';
        }
        break;
      case 'K':
        if (prev !== 'C') code += 'K';
        break;
      case 'P':
        if (next === 'H') {
          code += 'F';
          i++;
        } else {
          code += 'P';
        }
        break;
      case 'Q':
        code += 'K';
        break;
      case 'S':
        if (next === 'H') {
          code += 'X';
          i++;
        } else if (next === 'I' && (nextNext === 'A' || nextNext === 'O')) {
          code += 'X';
        } else {
          code += 'S';
        }
        break;
      case 'T':
        if (next === 'H') {
          code += '0'; // '0' represents 'TH' sound
          i++;
        } else if (next === 'I' && (nextNext === 'A' || nextNext === 'O')) {
          code += 'X';
        } else {
          code += 'T';
        }
        break;
      case 'V':
        code += 'F';
        break;
      case 'W':
      case 'Y':
        if ('AEIOU'.includes(next)) {
          code += char;
        }
        break;
      case 'X':
        code += 'KS';
        break;
      case 'Z':
        code += 'S';
        break;
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
    D: '3', T: '3',
    L: '4',
    M: '5', N: '5',
    R: '6',
  };

  const first = a[0];
  let res = first;
  let prevCode = codes[first] || '';

  for (let i = 1; i < a.length && res.length < 4; i++) {
    const code = codes[a[i]];
    if (code && code !== prevCode) {
      res += code;
      prevCode = code;
    } else if (!code) {
      prevCode = '';
    }
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
      matches1[i] = true;
      matches2[j] = true;
      matches++;
      break;
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

  // Winkler prefix boost
  let p = 0;
  const maxPrefix = Math.min(4, Math.min(len1, len2));
  for (let i = 0; i < maxPrefix; i++) {
    if (str1[i] === str2[i]) p++;
    else break;
  }

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
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
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
 * Multi-Pass Phonetic + String Similarity + Recency Contact Resolver
 * Resolves mispronunciations like "Thanos", "Tanoj", "Danoj" -> "Thanoj"
 */
export function resolveContactEntity(rawNameQuery: string, availableContacts?: Contact[]): ContactResolutionResult {
  const contacts = availableContacts || getSavedContacts();
  const searchedName = rawNameQuery.trim();

  if (!searchedName || contacts.length === 0) {
    return {
      status: 'NOT_FOUND',
      confidence: 0,
      searchedName,
    };
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
    let stringSim = jaroWinkler(queryLower, nameLower);
    let reason = '';

    // Pass 1: Exact full name match
    if (nameLower === queryLower) {
      score = 100;
      reason = 'Exact match';
    }
    // Pass 2: Prefix match (e.g. "thano" matches "Thanoj")
    else if (nameLower.startsWith(queryLower) || queryLower.startsWith(nameLower)) {
      score = 92;
      reason = 'Prefix match';
    }
    // Pass 3: Word-level exact match
    else if (queryWords.some(qw => nameWords.includes(qw))) {
      score = 85;
      reason = 'Word match';
    }
    else {
      // Pass 4: Phonetic Matching (Metaphone / Soundex) — Catches "Thanos"/"Tanoj"/"Danoj" vs "Thanoj"
      let maxPhoneticScore = 0;
      for (let i = 0; i < queryWords.length; i++) {
        const qw = queryWords[i];
        const qMeta = queryMetaphones[i];
        const qSnd = querySoundexes[i];

        for (let j = 0; j < nameWords.length; j++) {
          const nw = nameWords[j];
          const nMeta = nameMetaphones[j];
          const nSnd = nameSoundexes[j];

          // Metaphone exact key match (e.g., "Thanoj" & "Tanoj" both sound like "TNJ" or "0NJ")
          if (qMeta && nMeta && (qMeta === nMeta || qMeta.slice(0, 3) === nMeta.slice(0, 3))) {
            maxPhoneticScore = Math.max(maxPhoneticScore, 82);
            phoneticMatch = true;
          }
          // Soundex match fallback
          else if (qSnd && nSnd && qSnd === nSnd) {
            maxPhoneticScore = Math.max(maxPhoneticScore, 75);
            phoneticMatch = true;
          }
          // Near phonetic match (e.g., "Thanos" vs "Thanoj" -> "0NS" vs "0NJ")
          else if (qMeta && nMeta && jaroWinkler(qMeta, nMeta) >= 0.75) {
            maxPhoneticScore = Math.max(maxPhoneticScore, 78);
            phoneticMatch = true;
          }
        }
      }

      // Pass 5: Jaro-Winkler & Levenshtein String Distance
      let maxStringSim = 0;
      for (const qw of queryWords) {
        for (const nw of nameWords) {
          const jw = jaroWinkler(qw, nw);
          const levDist = levenshteinDistance(qw, nw);
          const levSim = 1 - (levDist / Math.max(qw.length, nw.length));

          const sim = Math.max(jw, levSim);
          if (sim > maxStringSim) maxStringSim = sim;
        }
      }

      stringSim = Math.max(stringSim, maxStringSim);

      if (maxPhoneticScore > 0) {
        score = Math.max(maxPhoneticScore, Math.round(stringSim * 85));
        reason = 'Phonetic match';
      } else if (stringSim >= 0.7) {
        score = Math.round(stringSim * 80);
        reason = `String similarity (${Math.round(stringSim * 100)}%)`;
      }
    }

    // Pass 6: Recency / Frequency Bias Weighting
    // Frequently / recently contacted people get up to +15 points boost
    const interactionCount = contact.interactionCount || 0;
    if (interactionCount > 0 && score > 30) {
      const frequencyBoost = Math.min(15, interactionCount * 3);
      score += frequencyBoost;
      reason += ` (+${frequencyBoost} frequency boost)`;
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
    return {
      status: 'NOT_FOUND',
      confidence: 0,
      searchedName,
    };
  }

  const topMatch = validMatches[0];
  const secondMatch = validMatches.length > 1 ? validMatches[1] : null;

  // High Confidence: Single top match with score >= 75 and margin >= 12 over 2nd candidate
  if (topMatch.score >= 75 && (!secondMatch || (topMatch.score - secondMatch.score) >= 12)) {
    return {
      status: 'RESOLVED',
      resolvedContact: topMatch.contact,
      confidence: topMatch.score,
      candidates: [topMatch.contact],
      searchedName,
    };
  }

  // Medium Confidence: Score between 50 and 74 OR close scores between candidates -> Ask Disambiguation Question!
  const candidates = validMatches.slice(0, 3).map(m => m.contact);
  const clarifyingQuestion = `Did you mean ${topMatch.contact.name}?`;

  return {
    status: 'DISAMBIGUATE',
    resolvedContact: topMatch.contact,
    candidates,
    confidence: topMatch.score,
    clarifyingQuestion,
    searchedName,
  };
}
