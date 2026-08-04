// frontend/lib/brain/learning-engine.ts
// Continuous Learning Engine for Insight AI OS.
// Persists execution records, successful tools, recovery steps, and timing to optimize future routing.

export interface ExecutionRecord {
  id: string;
  transcript: string;
  intent: string;
  toolsUsed: string[];
  success: boolean;
  recoveryAttempts: number;
  durationMs: number;
  timestamp: string;
  userCorrection?: string;
}

const STORAGE_KEY_LEARNING = 'insight_learning_engine_logs';

class LearningEngine {
  private records: ExecutionRecord[] = [];

  constructor() {
    this.load();
  }

  private load() {
    if (typeof window === 'undefined') return;
    try {
      const stored = localStorage.getItem(STORAGE_KEY_LEARNING);
      if (stored) this.records = JSON.parse(stored);
    } catch {}
  }

  private save() {
    if (typeof window === 'undefined') return;
    try {
      localStorage.setItem(STORAGE_KEY_LEARNING, JSON.stringify(this.records.slice(-200)));
    } catch {}
  }

  public recordExecution(entry: Omit<ExecutionRecord, 'id' | 'timestamp'>) {
    const record: ExecutionRecord = {
      ...entry,
      id: `learn_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      timestamp: new Date().toISOString(),
    };
    this.records.unshift(record);
    this.save();
  }

  public getTopSuccessfulTools(intentQuery: string): string[] {
    const q = intentQuery.toLowerCase();
    const matches = this.records.filter((r) => r.success && r.transcript.toLowerCase().includes(q));

    const freq: Record<string, number> = {};
    for (const m of matches) {
      for (const t of m.toolsUsed) {
        freq[t] = (freq[t] || 0) + 1;
      }
    }

    return Object.entries(freq)
      .sort(([, a], [, b]) => b - a)
      .map(([t]) => t);
  }

  public getHistory(): ExecutionRecord[] {
    return this.records;
  }
}

export const learningEngine = new LearningEngine();
