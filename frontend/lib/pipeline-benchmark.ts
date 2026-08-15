export interface LatencyBreakdown {
  cacheLookupMs: number;
  serverProcessingMs: number;
  embeddingMs: number;
  retrievalMs: number;
  rerankingMs: number;
  llmTtftMs: number;
  totalGenerationMs: number;
  totalEndToEndMs: number;
  networkEstimateMs: number;
  topKChunksUsed: number;
}

export interface ScenarioBenchmark {
  scenario: string;
  cacheLayer: string;
  beforeTtftMs: number;
  afterTtftMs: number;
  beforeTotalMs: number;
  afterTotalMs: number;
  improvementPercentage: number;
  breakdownAfter: LatencyBreakdown;
}

class PipelineInstrumenter {
  private startTime: number = 0;
  private cacheStart: number = 0;
  private cacheLookupMs: number = 0;
  private embeddingStart: number = 0;
  private embeddingMs: number = 0;
  private retrievalStart: number = 0;
  private retrievalMs: number = 0;
  private rerankStart: number = 0;
  private rerankMs: number = 0;
  private llmRequestStart: number = 0;
  private llmTtftMs: number = 0;
  private totalGenerationMs: number = 0;
  private topKChunks: number = 4;

  public startRequest(): void {
    this.startTime = performance.now();
  }

  public startCacheLookup(): void {
    this.cacheStart = performance.now();
  }

  public endCacheLookup(): void {
    this.cacheLookupMs = performance.now() - this.cacheStart;
  }

  public startEmbedding(): void {
    this.embeddingStart = performance.now();
  }

  public endEmbedding(): void {
    this.embeddingMs = performance.now() - this.embeddingStart;
  }

  public startRetrieval(): void {
    this.retrievalStart = performance.now();
  }

  public endRetrieval(): void {
    this.retrievalMs = performance.now() - this.retrievalStart;
  }

  public startRerank(): void {
    this.rerankStart = performance.now();
  }

  public endRerank(): void {
    this.rerankMs = performance.now() - this.rerankStart;
  }

  public startLlmRequest(): void {
    this.llmRequestStart = performance.now();
  }

  public markFirstToken(): void {
    if (this.llmRequestStart > 0 && this.llmTtftMs === 0) {
      this.llmTtftMs = performance.now() - this.llmRequestStart;
    }
  }

  public setTopKChunks(topK: number): void {
    this.topKChunks = topK;
  }

  public finalize(networkEstimateMs: number = 20): LatencyBreakdown {
    const totalEndToEndMs = performance.now() - this.startTime;
    if (this.llmRequestStart > 0) {
      this.totalGenerationMs = performance.now() - this.llmRequestStart;
    }

    const serverProcessingMs = totalEndToEndMs - (this.llmRequestStart > 0 ? (this.totalGenerationMs) : 0);

    return {
      cacheLookupMs: parseFloat(this.cacheLookupMs.toFixed(2)),
      serverProcessingMs: parseFloat(serverProcessingMs.toFixed(2)),
      embeddingMs: parseFloat(this.embeddingMs.toFixed(2)),
      retrievalMs: parseFloat(this.retrievalMs.toFixed(2)),
      rerankingMs: parseFloat(this.rerankMs.toFixed(2)),
      llmTtftMs: parseFloat((this.llmTtftMs || serverProcessingMs).toFixed(2)),
      totalGenerationMs: parseFloat(this.totalGenerationMs.toFixed(2)),
      totalEndToEndMs: parseFloat(totalEndToEndMs.toFixed(2)),
      networkEstimateMs,
      topKChunksUsed: this.topKChunks,
    };
  }
}

export function createInstrumenter(): PipelineInstrumenter {
  return new PipelineInstrumenter();
}

/**
 * Calculate percentage breakdown across request phases
 */
export function calculatePhasePercentages(b: LatencyBreakdown): Record<string, string> {
  const total = b.totalEndToEndMs || 1;
  return {
    cacheLookupPct: ((b.cacheLookupMs / total) * 100).toFixed(1) + '%',
    embeddingPct: ((b.embeddingMs / total) * 100).toFixed(1) + '%',
    retrievalPct: ((b.retrievalMs / total) * 100).toFixed(1) + '%',
    rerankingPct: ((b.rerankingMs / total) * 100).toFixed(1) + '%',
    llmTtftPct: ((b.llmTtftMs / total) * 100).toFixed(1) + '%',
    generationPct: ((b.totalGenerationMs / total) * 100).toFixed(1) + '%',
  };
}
