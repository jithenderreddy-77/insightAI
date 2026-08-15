import {
  computeDocHash,
  buildCAGDocumentCache,
  checkL1ExactCache,
  checkL2SemanticCache,
  evaluateL3CAGRoute,
  checkL4RetrievalCache,
  storeL4RetrievalCache,
  storeResponseCache,
  invalidateDocCache,
} from '../lib/cag-service';
import { createInstrumenter, calculatePhasePercentages } from '../lib/pipeline-benchmark';

describe('Latency Breakdown & Sub-3s TTFT Optimization Benchmark', () => {
  const samplePdf = `
# Enterprise Security Architecture 2026
Section 1: Data Encryption & Vault Standards
All data at rest is encrypted using AES-256 GCM algorithms. Transit data uses TLS 1.3 encryption protocols.
Section 2: Role-Based Access Control (RBAC)
User access control operates strictly under principle of least privilege managed through OAuth 2.0 & OIDC tokens.
Section 3: Threat Mitigation & Audit Logs
Automated intrusion detection monitors API endpoints continuously with immutable audit logging enabled.
`;

  let docHash: string;

  beforeAll(() => {
    docHash = computeDocHash(samplePdf, 'enterprise-security.pdf');
    invalidateDocCache(docHash);
    buildCAGDocumentCache(docHash, 'enterprise-security.pdf', samplePdf);
  });

  test('1. Benchmark L1 Exact Cache Hit (User Send -> First Token)', () => {
    const inst = createInstrumenter();
    inst.startRequest();
    inst.startCacheLookup();

    const query = 'What encryption algorithm is used for data at rest?';
    storeResponseCache(docHash, query, 'All data at rest is encrypted using AES-256 GCM.', undefined, 'L5');

    const hit = checkL1ExactCache(docHash, query);
    inst.endCacheLookup();

    const breakdown = inst.finalize(15);
    const percentages = calculatePhasePercentages(breakdown);

    expect(hit).not.toBeNull();
    expect(breakdown.cacheLookupMs).toBeLessThan(10);
    expect(breakdown.totalEndToEndMs).toBeLessThan(50);

    console.log(`\n--- BENCHMARK SCENARIO 1: L1 EXACT CACHE HIT ---`);
    console.log(`Cache Lookup: ${breakdown.cacheLookupMs} ms (${percentages.cacheLookupPct})`);
    console.log(`Server Processing: ${breakdown.serverProcessingMs} ms`);
    console.log(`Total End-to-End: ${breakdown.totalEndToEndMs} ms`);
  });

  test('2. Benchmark L2 Semantic Cache Hit', () => {
    const inst = createInstrumenter();
    inst.startRequest();
    inst.startEmbedding();

    const query1 = 'What encryption algorithm is used?';
    const query2 = 'Which cipher encrypts stored data?';
    const answer = 'All data at rest is encrypted using AES-256 GCM.';
    const vec1 = [0.2, 0.4, 0.7, 0.1];
    const vec2 = [0.201, 0.399, 0.702, 0.099]; // ~0.99 similarity

    storeResponseCache(docHash, query1, answer, vec1, 'L5');
    inst.endEmbedding();

    inst.startCacheLookup();
    const hit = checkL2SemanticCache(docHash, query2, vec2);
    inst.endCacheLookup();

    const breakdown = inst.finalize(15);
    const percentages = calculatePhasePercentages(breakdown);

    expect(hit).not.toBeNull();
    expect(breakdown.totalEndToEndMs).toBeLessThan(100);

    console.log(`\n--- BENCHMARK SCENARIO 2: L2 SEMANTIC CACHE HIT ---`);
    console.log(`Embedding Time: ${breakdown.embeddingMs} ms (${percentages.embeddingPct})`);
    console.log(`Cache Lookup: ${breakdown.cacheLookupMs} ms (${percentages.cacheLookupPct})`);
    console.log(`Total End-to-End: ${breakdown.totalEndToEndMs} ms`);
  });

  test('3. Benchmark L3 CAG Summary Route', () => {
    const inst = createInstrumenter();
    inst.startRequest();
    inst.startCacheLookup();

    const route = evaluateL3CAGRoute(docHash, 'Provide an architectural summary of this security document');
    inst.endCacheLookup();

    const breakdown = inst.finalize(15);

    expect(route.hit).toBe(true);
    expect(breakdown.totalEndToEndMs).toBeLessThan(50);

    console.log(`\n--- BENCHMARK SCENARIO 3: L3 CAG SUMMARY ROUTE ---`);
    console.log(`CAG Evaluation: ${breakdown.cacheLookupMs} ms`);
    console.log(`Total End-to-End: ${breakdown.totalEndToEndMs} ms`);
  });

  test('4. Benchmark Top-K Chunk Tuning (3, 4, 5, 6 chunks)', () => {
    const topKValues = [3, 4, 5, 6];

    console.log(`\n--- BENCHMARK SCENARIO 4: TOP-K CHUNK TUNING ---`);
    topKValues.forEach((topK) => {
      const inst = createInstrumenter();
      inst.startRequest();
      inst.setTopKChunks(topK);

      // Simulate retrieval & prompt construction for topK chunks
      inst.startRetrieval();
      const mockChunks = Array(topK).fill({ content: 'Sample encryption details chunk content...' });
      inst.endRetrieval();

      inst.startRerank();
      const promptContext = mockChunks.map((c, i) => `[Chunk ${i + 1}] ${c.content}`).join('\n');
      inst.endRerank();

      const breakdown = inst.finalize(15);

      expect(promptContext.length).toBeGreaterThan(0);
      console.log(`Top-K = ${topK} Chunks | Context Length = ${promptContext.length} chars | Setup Latency = ${breakdown.totalEndToEndMs} ms`);
    });
  });
});
