import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

export interface CacheConfig {
  enableL1Exact: boolean;
  enableL2Semantic: boolean;
  enableL3CAG: boolean;
  enableL4Retrieval: boolean;
  enableL5RAGFallback: boolean;
  semanticSimilarityThreshold: number;
  cagConfidenceThreshold: number;
}

export const DEFAULT_CACHE_CONFIG: CacheConfig = {
  enableL1Exact: true,
  enableL2Semantic: true,
  enableL3CAG: true,
  enableL4Retrieval: true,
  enableL5RAGFallback: true,
  semanticSimilarityThreshold: 0.88,
  cagConfidenceThreshold: 0.70,
};

export interface CAGDocumentCache {
  docHash: string;
  filename: string;
  summary: string;
  sectionSummaries: { title: string; content: string }[];
  keyConcepts: string[];
  entities: string[];
  relationships: string[];
  structure: string[];
  frequentlyUsefulFacts: string[];
  createdAt: number;
}

export interface CachedResponse {
  docHash: string;
  query: string;
  queryEmbedding?: number[];
  response: string;
  sourceLayer: 'L1' | 'L2' | 'L3' | 'L4' | 'L5';
  createdAt: number;
}

export interface CachedRetrievalResult {
  docHash: string;
  queryKey: string;
  queryEmbedding?: number[];
  documents: any[];
  createdAt: number;
}

export interface TelemetryMetric {
  timestamp: string;
  docHash: string;
  cacheLayer: 'L1' | 'L2' | 'L3' | 'L4' | 'L5';
  latencyMs: number;
  queryLength: number;
  isCacheHit: boolean;
}

// Memory caches
const l1ExactCache = new Map<string, CachedResponse>();
const l2SemanticCache = new Map<string, CachedResponse[]>(); // docHash -> responses
const l3CAGCache = new Map<string, CAGDocumentCache>();
const l4RetrievalCache = new Map<string, CachedRetrievalResult>();
const telemetryLogs: TelemetryMetric[] = [];

// Persistent storage path
const PERSISTENT_CACHE_DIR = path.join(process.cwd(), '.cache');
const CAG_PERSIST_FILE = path.join(PERSISTENT_CACHE_DIR, 'cag_store.json');
const RESP_PERSIST_FILE = path.join(PERSISTENT_CACHE_DIR, 'response_store.json');

// Initialize persistent cache from disk on startup
let isInitialized = false;
export function initializePersistentCache(): void {
  if (isInitialized) return;
  try {
    if (!fs.existsSync(PERSISTENT_CACHE_DIR)) {
      fs.mkdirSync(PERSISTENT_CACHE_DIR, { recursive: true });
    }

    if (fs.existsSync(CAG_PERSIST_FILE)) {
      const data = JSON.parse(fs.readFileSync(CAG_PERSIST_FILE, 'utf-8'));
      Object.entries(data).forEach(([hash, val]) => {
        l3CAGCache.set(hash, val as CAGDocumentCache);
      });
    }

    if (fs.existsSync(RESP_PERSIST_FILE)) {
      const data = JSON.parse(fs.readFileSync(RESP_PERSIST_FILE, 'utf-8'));
      Object.entries(data).forEach(([key, val]) => {
        l1ExactCache.set(key, val as CachedResponse);
      });
    }
    isInitialized = true;
  } catch (err: any) {
    console.log(`[CAG CACHE] Persistent store initialization note: ${err?.message}`);
  }
}

function savePersistentCache(): void {
  try {
    if (!fs.existsSync(PERSISTENT_CACHE_DIR)) {
      fs.mkdirSync(PERSISTENT_CACHE_DIR, { recursive: true });
    }
    const cagObj: Record<string, CAGDocumentCache> = {};
    l3CAGCache.forEach((val, key) => (cagObj[key] = val));
    fs.writeFileSync(CAG_PERSIST_FILE, JSON.stringify(cagObj, null, 2), 'utf-8');

    const respObj: Record<string, CachedResponse> = {};
    l1ExactCache.forEach((val, key) => (respObj[key] = val));
    fs.writeFileSync(RESP_PERSIST_FILE, JSON.stringify(respObj, null, 2), 'utf-8');
  } catch {}
}

/**
 * Compute SHA-256 Fingerprint for Document Versioning
 */
export function computeDocHash(content: string, filename: string = 'doc'): string {
  const hash = crypto.createHash('sha256');
  hash.update(filename);
  hash.update('::');
  hash.update(content.slice(0, 10000)); // Sample content signature
  hash.update('::');
  hash.update(content.length.toString());
  return hash.digest('hex').slice(0, 16);
}

/**
 * Cache Invalidation Rule: Purge all caches for a specific document hash when changed
 */
export function invalidateDocCache(docHash: string): void {
  if (!docHash) return;

  l3CAGCache.delete(docHash);
  l2SemanticCache.delete(docHash);

  Array.from(l1ExactCache.keys()).forEach((key) => {
    if (key.startsWith(`${docHash}:`)) l1ExactCache.delete(key);
  });

  Array.from(l4RetrievalCache.keys()).forEach((key) => {
    if (key.startsWith(`${docHash}:`)) l4RetrievalCache.delete(key);
  });

  savePersistentCache();
  console.log(`[CAG CACHE INVALIDATION] Cleared cache for docHash: ${docHash}`);
}

/**
 * Precompute L3 CAG Document Cache upon PDF ingest
 */
export function buildCAGDocumentCache(
  docHash: string,
  filename: string,
  fullText: string
): CAGDocumentCache {
  initializePersistentCache();

  // Extract key facts and sections
  const lines = fullText.split('\n').map((l) => l.trim()).filter(Boolean);
  const summary = fullText.slice(0, 800).replace(/\s+/g, ' ').trim();

  const sectionSummaries: { title: string; content: string }[] = [];
  const keyConcepts: string[] = [];
  const entities: string[] = [];
  const relationships: string[] = [];
  const structure: string[] = [];
  const frequentlyUsefulFacts: string[] = [];

  let currentSection = 'Introduction';
  let sectionText = '';

  for (const line of lines) {
    if (/^(#|chapter|section|\d+\.)/i.test(line) && line.length < 80) {
      if (sectionText.length > 50) {
        sectionSummaries.push({ title: currentSection, content: sectionText.slice(0, 300) });
        structure.push(currentSection);
      }
      currentSection = line.replace(/^[#\d.\s]+/, '').trim();
      sectionText = '';
    } else {
      sectionText += line + ' ';

      // Extract entities & concepts
      if (line.includes(':') && line.length < 120) {
        const parts = line.split(':');
        if (parts[0].trim().length > 3 && parts[0].trim().length < 40) {
          keyConcepts.push(parts[0].trim());
          frequentlyUsefulFacts.push(line.trim());
        }
      }
    }
  }

  if (sectionText.length > 50) {
    sectionSummaries.push({ title: currentSection, content: sectionText.slice(0, 300) });
    structure.push(currentSection);
  }

  const cagCache: CAGDocumentCache = {
    docHash,
    filename,
    summary,
    sectionSummaries: sectionSummaries.slice(0, 8),
    keyConcepts: Array.from(new Set(keyConcepts)).slice(0, 10),
    entities: Array.from(new Set(entities)).slice(0, 8),
    relationships: Array.from(new Set(relationships)).slice(0, 6),
    structure: structure.slice(0, 10),
    frequentlyUsefulFacts: frequentlyUsefulFacts.slice(0, 8),
    createdAt: Date.now(),
  };

  l3CAGCache.set(docHash, cagCache);
  savePersistentCache();

  return cagCache;
}

/**
 * Get L3 CAG Cache for a document
 */
export function getCAGDocumentCache(docHash: string): CAGDocumentCache | null {
  initializePersistentCache();
  return l3CAGCache.get(docHash) || null;
}

/**
 * Check L1 Exact Response Cache (<1ms)
 */
export function checkL1ExactCache(
  docHash: string,
  query: string,
  config: CacheConfig = DEFAULT_CACHE_CONFIG
): CachedResponse | null {
  if (!config.enableL1Exact || !docHash) return null;
  initializePersistentCache();

  const key = `${docHash}:${query.toLowerCase().trim()}`;
  const hit = l1ExactCache.get(key);
  if (hit) {
    logTelemetry({
      timestamp: new Date().toISOString(),
      docHash,
      cacheLayer: 'L1',
      latencyMs: 1,
      queryLength: query.length,
      isCacheHit: true,
    });
    return hit;
  }
  return null;
}

/**
 * Check L2 Semantic Response Cache
 */
export function checkL2SemanticCache(
  docHash: string,
  query: string,
  queryEmbedding: number[],
  config: CacheConfig = DEFAULT_CACHE_CONFIG
): CachedResponse | null {
  if (!config.enableL2Semantic || !docHash || !queryEmbedding || queryEmbedding.length === 0) return null;
  initializePersistentCache();

  const responses = l2SemanticCache.get(docHash) || [];
  let bestHit: CachedResponse | null = null;
  let highestSim = 0;

  for (const resp of responses) {
    if (resp.queryEmbedding && resp.queryEmbedding.length === queryEmbedding.length) {
      const sim = cosineSimilarity(queryEmbedding, resp.queryEmbedding);
      if (sim > highestSim && sim >= config.semanticSimilarityThreshold) {
        highestSim = sim;
        bestHit = resp;
      }
    }
  }

  if (bestHit) {
    logTelemetry({
      timestamp: new Date().toISOString(),
      docHash,
      cacheLayer: 'L2',
      latencyMs: 5,
      queryLength: query.length,
      isCacheHit: true,
    });
    return bestHit;
  }

  return null;
}

/**
 * Evaluate L3 CAG Confidence & Route
 */
export function evaluateL3CAGRoute(
  docHash: string,
  query: string,
  config: CacheConfig = DEFAULT_CACHE_CONFIG
): { hit: boolean; cagContext?: string; confidence: number } {
  if (!config.enableL3CAG || !docHash) return { hit: false, confidence: 0 };
  initializePersistentCache();

  const cagData = l3CAGCache.get(docHash);
  if (!cagData) return { hit: false, confidence: 0 };

  const qLower = query.toLowerCase();
  const isBroadQuery =
    qLower.includes('summarize') ||
    qLower.includes('summary') ||
    qLower.includes('overview') ||
    qLower.includes('main points') ||
    qLower.includes('key concepts') ||
    qLower.includes('table of contents') ||
    qLower.includes('what is this document about') ||
    qLower.includes('structure');

  let confidence = 0;
  if (isBroadQuery) {
    confidence = 0.90;
  } else {
    // Check keyword match in key concepts or structure
    const matchingConcepts = cagData.keyConcepts.filter((c) => qLower.includes(c.toLowerCase()));
    if (matchingConcepts.length > 0) {
      confidence = 0.75;
    }
  }

  if (confidence >= config.cagConfidenceThreshold) {
    const cagContext = `DOCUMENT CAG SUMMARY (${cagData.filename}):
${cagData.summary}

KEY CONCEPTS:
${cagData.keyConcepts.join(', ')}

DOCUMENT STRUCTURE:
${cagData.structure.join(' -> ')}

FACT EXTRACTS:
${cagData.frequentlyUsefulFacts.join('\n')}`;

    logTelemetry({
      timestamp: new Date().toISOString(),
      docHash,
      cacheLayer: 'L3',
      latencyMs: 8,
      queryLength: query.length,
      isCacheHit: true,
    });

    return { hit: true, cagContext, confidence };
  }

  return { hit: false, confidence };
}

/**
 * Check L4 Retrieval Result Cache
 */
export function checkL4RetrievalCache(
  docHash: string,
  queryKey: string,
  config: CacheConfig = DEFAULT_CACHE_CONFIG
): CachedRetrievalResult | null {
  if (!config.enableL4Retrieval || !docHash) return null;
  initializePersistentCache();

  const key = `${docHash}:${queryKey.toLowerCase().trim()}`;
  return l4RetrievalCache.get(key) || null;
}

/**
 * Store L4 Retrieval Result Cache
 */
export function storeL4RetrievalCache(
  docHash: string,
  queryKey: string,
  documents: any[],
  queryEmbedding?: number[]
): void {
  if (!docHash) return;
  const key = `${docHash}:${queryKey.toLowerCase().trim()}`;
  l4RetrievalCache.set(key, {
    docHash,
    queryKey,
    queryEmbedding,
    documents,
    createdAt: Date.now(),
  });
}

/**
 * Store Synthesized Response in L1 & L2 Cache
 */
export function storeResponseCache(
  docHash: string,
  query: string,
  response: string,
  queryEmbedding?: number[],
  sourceLayer: 'L1' | 'L2' | 'L3' | 'L4' | 'L5' = 'L5'
): void {
  if (!docHash || !response || response.trim().length === 0) return;
  initializePersistentCache();

  const exactKey = `${docHash}:${query.toLowerCase().trim()}`;
  const cachedItem: CachedResponse = {
    docHash,
    query,
    queryEmbedding,
    response,
    sourceLayer,
    createdAt: Date.now(),
  };

  l1ExactCache.set(exactKey, cachedItem);

  const semanticList = l2SemanticCache.get(docHash) || [];
  semanticList.push(cachedItem);
  l2SemanticCache.set(docHash, semanticList.slice(-50)); // Keep top 50 per doc

  savePersistentCache();
}

/**
 * Log Lightweight Telemetry Metrics (No sensitive text)
 */
export function logTelemetry(metric: TelemetryMetric): void {
  telemetryLogs.push(metric);
  if (telemetryLogs.length > 500) telemetryLogs.shift();
  console.log(
    `[TELEMETRY] timestamp=${metric.timestamp} docHash=${metric.docHash} layer=${metric.cacheLayer} latencyMs=${metric.latencyMs} hit=${metric.isCacheHit}`
  );
}

export function getTelemetryLogs(): TelemetryMetric[] {
  return [...telemetryLogs];
}

/**
 * Cosine Similarity Helper
 */
function cosineSimilarity(a: number[], b: number[]): number {
  if (!a || !b || a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return normA === 0 || normB === 0 ? 0 : dot / (Math.sqrt(normA) * Math.sqrt(normB));
}
