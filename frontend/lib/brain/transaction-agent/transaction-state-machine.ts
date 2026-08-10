/**
 * lib/brain/transaction-agent/transaction-state-machine.ts
 *
 * State machine and duplicate transaction prevention engine.
 * Tracks active transaction lifecycle states, handles idempotency keys,
 * prevents double purchases/bookings, and persists transaction history.
 */

import type { TransactionRecord, TransactionState, TransactionIntent, ProductConstraintFilter } from './types';

const STORAGE_KEY = 'insight_transaction_history';
const ACTIVE_TX_KEY = 'insight_active_transaction';

const VALID_TRANSITIONS: Record<TransactionState, TransactionState[]> = {
  DISCOVERING: ['SEARCHING', 'CANCELLED', 'FAILED'],
  SEARCHING: ['COMPARING', 'SELECTING', 'FAILED', 'CANCELLED'],
  COMPARING: ['SELECTING', 'SEARCHING', 'CANCELLED', 'FAILED'],
  SELECTING: ['PREPARING', 'SEARCHING', 'CANCELLED', 'FAILED'],
  PREPARING: ['AWAITING_CONFIRMATION', 'COMPLETED', 'FAILED', 'CANCELLED'], // Cart addition can go directly to COMPLETED after verification
  AWAITING_CONFIRMATION: ['EXECUTING', 'PREPARING', 'CANCELLED', 'FAILED'],
  EXECUTING: ['VERIFYING', 'FAILED', 'RECOVERING'],
  VERIFYING: ['COMPLETED', 'FAILED', 'RECOVERING'],
  RECOVERING: ['VERIFYING', 'EXECUTING', 'FAILED', 'CANCELLED'],
  COMPLETED: [],
  FAILED: ['RECOVERING', 'CANCELLED'],
  CANCELLED: [],
};

class TransactionStateMachine {
  private activeTransaction: TransactionRecord | null = null;

  constructor() {
    this.loadFromStorage();
  }

  private loadFromStorage() {
    if (typeof window === 'undefined' || typeof localStorage === 'undefined') return;
    try {
      const storedActive = localStorage.getItem(ACTIVE_TX_KEY);
      if (storedActive) {
        this.activeTransaction = JSON.parse(storedActive);
      }
    } catch (err) {
      console.error('Failed to load active transaction:', err);
    }
  }

  private saveToStorage() {
    if (typeof window === 'undefined' || typeof localStorage === 'undefined') return;
    try {
      if (this.activeTransaction) {
        localStorage.setItem(ACTIVE_TX_KEY, JSON.stringify(this.activeTransaction));
        const history = this.getTransactionHistory();
        const existsIdx = history.findIndex(t => t.transactionId === this.activeTransaction!.transactionId);
        if (existsIdx >= 0) {
          history[existsIdx] = this.activeTransaction;
        } else {
          history.unshift(this.activeTransaction);
        }
        localStorage.setItem(STORAGE_KEY, JSON.stringify(history.slice(0, 50)));
      } else {
        localStorage.removeItem(ACTIVE_TX_KEY);
      }
    } catch (err) {
      console.error('Failed to save transaction state:', err);
    }
  }

  /**
   * Create a new transaction record with a unique transactionId and attemptId.
   */
  public createTransaction(
    intent: TransactionIntent,
    platform: string,
    constraints: ProductConstraintFilter,
    userId: string = 'local_user',
  ): TransactionRecord {
    // If an active transaction exists in an uncompleted state, check for idempotency
    if (this.activeTransaction && (this.activeTransaction.state === 'AWAITING_CONFIRMATION' || this.activeTransaction.state === 'EXECUTING')) {
      if (this.isDuplicateRequest(intent, platform, constraints)) {
        return this.activeTransaction;
      }
    }

    const now = new Date().toISOString();
    const tx: TransactionRecord = {
      transactionId: `tx_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      attemptId: `att_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      userId,
      intent,
      platform,
      platformStatus: 'SUPPORTED_AND_TESTED',
      state: 'DISCOVERING',
      createdAt: now,
      updatedAt: now,
      expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(), // 15 min expiry
      constraints,
    };

    this.activeTransaction = tx;
    this.saveToStorage();
    return tx;
  }

  /**
   * Check if a new request is a duplicate of the active transaction.
   */
  public isDuplicateRequest(
    intent: TransactionIntent,
    platform: string,
    constraints: ProductConstraintFilter,
  ): boolean {
    if (!this.activeTransaction) return false;
    if (this.activeTransaction.state === 'COMPLETED' || this.activeTransaction.state === 'CANCELLED') return false;

    const sameIntent = this.activeTransaction.intent === intent;
    const samePlatform = this.activeTransaction.platform.toLowerCase() === platform.toLowerCase();
    const sameCategory = (this.activeTransaction.constraints.category || '').toLowerCase() === (constraints.category || '').toLowerCase();
    const sameQuery = (this.activeTransaction.constraints.rawQuery || '').toLowerCase() === (constraints.rawQuery || '').toLowerCase();

    return sameIntent && (samePlatform || sameCategory || sameQuery);
  }

  /**
   * Safely transition transaction state to next valid state.
   */
  public transitionState(
    transactionId: string,
    nextState: TransactionState,
    updates?: Partial<TransactionRecord>,
  ): TransactionRecord | null {
    if (!this.activeTransaction || this.activeTransaction.transactionId !== transactionId) {
      // Find in history if not active
      const history = this.getTransactionHistory();
      const tx = history.find(t => t.transactionId === transactionId);
      if (!tx) return null;
      this.activeTransaction = tx;
    }

    const currentState = this.activeTransaction.state;
    const allowed = VALID_TRANSITIONS[currentState];

    if (!allowed || !allowed.includes(nextState)) {
      console.warn(`[TransactionState] Invalid transition from ${currentState} to ${nextState}`);
      // Permit recovery or cancellation always
      if (nextState !== 'CANCELLED' && nextState !== 'FAILED' && nextState !== 'RECOVERING') {
        return this.activeTransaction;
      }
    }

    const now = new Date().toISOString();
    this.activeTransaction = {
      ...this.activeTransaction,
      ...updates,
      state: nextState,
      updatedAt: now,
    };

    if (nextState === 'COMPLETED' || nextState === 'CANCELLED') {
      const finished = { ...this.activeTransaction };
      this.saveToStorage();
      this.activeTransaction = null;
      if (typeof window !== 'undefined') {
        localStorage.removeItem(ACTIVE_TX_KEY);
      }
      return finished;
    }

    this.saveToStorage();
    return this.activeTransaction;
  }

  /**
   * Get active transaction record.
   */
  public getActiveTransaction(): TransactionRecord | null {
    if (this.activeTransaction && this.activeTransaction.expiresAt) {
      if (new Date(this.activeTransaction.expiresAt).getTime() < Date.now()) {
        this.activeTransaction.state = 'CANCELLED';
        this.activeTransaction.failureReason = 'Confirmation expired';
        this.saveToStorage();
        this.activeTransaction = null;
      }
    }
    return this.activeTransaction;
  }

  /**
   * Get full transaction history.
   */
  public getTransactionHistory(): TransactionRecord[] {
    if (typeof window === 'undefined' || typeof localStorage === 'undefined') return [];
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  }

  /**
   * Cancel active transaction.
   */
  public cancelActiveTransaction(reason: string = 'User cancelled'): TransactionRecord | null {
    if (!this.activeTransaction) return null;
    return this.transitionState(this.activeTransaction.transactionId, 'CANCELLED', {
      failureReason: reason,
    });
  }
}

export const transactionStateMachine = new TransactionStateMachine();
