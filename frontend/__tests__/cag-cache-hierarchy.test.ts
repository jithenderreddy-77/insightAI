import {
  computeDocHash,
  buildCAGDocumentCache,
  getCAGDocumentCache,
  checkL1ExactCache,
  checkL2SemanticCache,
  evaluateL3CAGRoute,
  checkL4RetrievalCache,
  storeL4RetrievalCache,
  storeResponseCache,
  invalidateDocCache,
  DEFAULT_CACHE_CONFIG,
} from '../lib/cag-service';

describe('CAG & 5-Layer Cache Hierarchy (L1-L5)', () => {
  const samplePdfText1 = `
# Architecture & Design Specifications
Section 1: Overview
The system uses a Next.js frontend, LangChain RAG pipeline, and Supabase vector database.
Section 2: Security & Authentication
Authentication is managed via JWT tokens and encrypted role-based policies.
`;

  const samplePdfText2 = `
# Financial Report 2026
Section 1: Revenue Metrics
Total revenue for Q1 reached $12.5M, representing a 24% year-over-year growth.
`;

  let docHash1: string;
  let docHash2: string;

  beforeAll(() => {
    docHash1 = computeDocHash(samplePdfText1, 'architecture.pdf');
    docHash2 = computeDocHash(samplePdfText2, 'financials.pdf');

    invalidateDocCache(docHash1);
    invalidateDocCache(docHash2);
  });

  test('1. Precomputes L3 CAG Document Cache upon PDF ingest', () => {
    const start = performance.now();
    const cagCache = buildCAGDocumentCache(docHash1, 'architecture.pdf', samplePdfText1);
    const duration = performance.now() - start;

    expect(cagCache).toBeDefined();
    expect(cagCache.docHash).toBe(docHash1);
    expect(cagCache.summary).toContain('Architecture & Design Specifications');
    expect(cagCache.structure.length).toBeGreaterThan(0);
    console.log(`[BENCHMARK] CAG Precomputation Latency: ${duration.toFixed(2)} ms`);
  });

  test('2. L3 CAG Route Hits for broad summary query', () => {
    const start = performance.now();
    const cagRoute = evaluateL3CAGRoute(docHash1, 'Summarize this document');
    const duration = performance.now() - start;

    expect(cagRoute.hit).toBe(true);
    expect(cagRoute.cagContext).toContain('DOCUMENT CAG SUMMARY');
    console.log(`[BENCHMARK] L3 CAG Route Hit Latency: ${duration.toFixed(2)} ms`);
  });

  test('3. Stores synthesized response and hits L1 Exact Cache on exact repeat query', () => {
    const query = 'What authentication method is used?';
    const answer = 'Authentication is managed via JWT tokens and encrypted role-based policies.';

    storeResponseCache(docHash1, query, answer, undefined, 'L5');

    const start = performance.now();
    const l1Hit = checkL1ExactCache(docHash1, query);
    const duration = performance.now() - start;

    expect(l1Hit).not.toBeNull();
    expect(l1Hit?.response).toBe(answer);
    expect(l1Hit?.sourceLayer).toBe('L5');
    console.log(`[BENCHMARK] L1 Exact Response Cache Hit Latency: ${duration.toFixed(2)} ms`);
  });

  test('4. Hits L2 Semantic Response Cache for semantically similar query', () => {
    const query1 = 'What database is used?';
    const query2 = 'Which database engine handles vector storage?';
    const answer = 'Supabase vector database is used for semantic search.';

    const mockVec1 = [0.1, 0.2, 0.8, 0.5];
    const mockVec2 = [0.1, 0.21, 0.79, 0.51]; // Similarity ~ 0.99 > 0.88 threshold

    storeResponseCache(docHash1, query1, answer, mockVec1, 'L5');

    const start = performance.now();
    const l2Hit = checkL2SemanticCache(docHash1, query2, mockVec2);
    const duration = performance.now() - start;

    expect(l2Hit).not.toBeNull();
    expect(l2Hit?.response).toBe(answer);
    console.log(`[BENCHMARK] L2 Semantic Cache Hit Latency: ${duration.toFixed(2)} ms`);
  });

  test('5. Stores and hits L4 Retrieval Result Cache', () => {
    const queryKey = 'security policies';
    const docs = [{ content: 'Authentication is managed via JWT tokens.', metadata: { filename: 'architecture.pdf' } }];

    storeL4RetrievalCache(docHash1, queryKey, docs);

    const start = performance.now();
    const l4Hit = checkL4RetrievalCache(docHash1, queryKey);
    const duration = performance.now() - start;

    expect(l4Hit).not.toBeNull();
    expect(l4Hit?.documents.length).toBe(1);
    console.log(`[BENCHMARK] L4 Retrieval Result Cache Hit Latency: ${duration.toFixed(2)} ms`);
  });

  test('6. Enforces strict Document Hash scoping (Answers from different PDFs never mix)', () => {
    const query = 'What authentication method is used?';
    const l1HitCrossDoc = checkL1ExactCache(docHash2, query);

    expect(l1HitCrossDoc).toBeNull(); // Must NOT hit cache from docHash1!
  });

  test('7. Cache Invalidation clears old document cache when PDF changes', () => {
    const query = 'What authentication method is used?';
    expect(checkL1ExactCache(docHash1, query)).not.toBeNull();

    // Invalidate
    invalidateDocCache(docHash1);

    expect(checkL1ExactCache(docHash1, query)).toBeNull();
    expect(getCAGDocumentCache(docHash1)).toBeNull();
  });
});
