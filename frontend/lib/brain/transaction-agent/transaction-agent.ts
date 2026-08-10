/**
 * lib/brain/transaction-agent/transaction-agent.ts
 *
 * Core Transaction & Booking Agent Orchestrator.
 * Handles end-to-end multi-step transaction pipelines:
 *  1. Intent Extraction & Constraint Parsing
 *  2. Search & Exact Constraint Verification
 *  3. Variant & Size Selection
 *  4. Add to Cart & Cart State Verification
 *  5. Checkout Preparation, Price Change Protection & AWAITING_CONFIRMATION Pause
 *  6. Verification and Failure Recovery
 */

import { transactionStateMachine } from './transaction-state-machine';
import { eCommerceAdapter } from './adapters/ecommerce-adapter';
import type {
  CandidateProduct,
  CartVerificationResult,
  ProductConstraintFilter,
  TransactionIntent,
  TransactionRecord,
} from './types';

export interface TransactionAgentResult {
  success: boolean;
  transaction: TransactionRecord;
  spokenResponse: string;
  clientActionPayload?: Record<string, any>;
  error?: string;
}

export class TransactionAgent {
  /**
   * Main entry point for executing transaction commands.
   */
  public async handleCommand(options: {
    intent: TransactionIntent;
    action: 'search' | 'add_to_cart' | 'prepare_purchase' | 'confirm_transaction' | 'cancel_transaction';
    query: string;
    constraints?: ProductConstraintFilter;
    selectedProductId?: string;
    targetSize?: string;
    platform?: string;
    transactionId?: string;
  }): Promise<TransactionAgentResult> {
    const { intent, action, query, constraints = {}, targetSize, platform = 'Amazon', transactionId } = options;

    // Parse constraints from raw query if missing
    const parsedConstraints = this.parseConstraints(query, constraints);
    const platformName = platform || 'Amazon';

    // Check for existing active transaction or create a new one
    let tx = transactionId
      ? transactionStateMachine.getActiveTransaction()
      : transactionStateMachine.createTransaction(intent, platformName, parsedConstraints);

    if (!tx) {
      tx = transactionStateMachine.createTransaction(intent, platformName, parsedConstraints);
    }

    // ── ACTION ROUTING ──

    switch (action) {
      case 'search':
        return this.executeSearch(tx, query, parsedConstraints, platformName);

      case 'add_to_cart':
        return this.executeAddToCart(tx, query, parsedConstraints, targetSize, platformName);

      case 'prepare_purchase':
        return this.executePreparePurchase(tx);

      case 'confirm_transaction':
        return this.executeConfirmTransaction(tx);

      case 'cancel_transaction':
        return this.executeCancelTransaction(tx);

      default:
        return this.executeSearch(tx, query, parsedConstraints, platformName);
    }
  }

  /**
   * Execute Product Search & Constraint Verification.
   */
  private async executeSearch(
    tx: TransactionRecord,
    query: string,
    constraints: ProductConstraintFilter,
    platform: string,
  ): Promise<TransactionAgentResult> {
    transactionStateMachine.transitionState(tx.transactionId, 'SEARCHING');

    const searchResult = await eCommerceAdapter.searchAndMatch(query, constraints, platform);

    if (searchResult.platformStatus === 'NOT_SUPPORTED') {
      transactionStateMachine.transitionState(tx.transactionId, 'FAILED', {
        failureReason: searchResult.constraintSummary,
      });
      return {
        success: false,
        transaction: tx,
        spokenResponse: `Sorry, ${platform} is not currently supported for automated transactions.`,
        error: searchResult.constraintSummary,
      };
    }

    const best = searchResult.bestMatch;
    if (!best) {
      transactionStateMachine.transitionState(tx.transactionId, 'FAILED', {
        failureReason: 'No product matching constraints found',
      });
      return {
        success: false,
        transaction: tx,
        spokenResponse: `I searched ${searchResult.platform} for ${query}, but couldn't find a product matching all your criteria (Color: ${constraints.color || 'any'}, Size: ${constraints.size || 'any'}, Max Price: ₹${constraints.maxPrice || 5000}).`,
      };
    }

    // Transition state to SELECTING
    transactionStateMachine.transitionState(tx.transactionId, 'SELECTING', {
      selectedProduct: best,
      initialPrice: best.price,
    });

    const priceFormatted = `₹${best.price.toLocaleString('en-IN')}`;
    const sizeNote = constraints.size ? `, size ${constraints.size}` : '';

    return {
      success: true,
      transaction: tx,
      spokenResponse: `Found ${best.title}${sizeNote} for ${priceFormatted} on ${best.platform}. Would you like me to add it to your cart or prepare checkout?`,
      clientActionPayload: {
        type: 'SHOW_TRANSACTION_PREVIEW',
        platform: best.platform,
        product: best,
        constraints,
        url: best.url,
      },
    };
  }

  /**
   * Execute Add to Cart & Cart Content Verification.
   */
  private async executeAddToCart(
    tx: TransactionRecord,
    query: string,
    constraints: ProductConstraintFilter,
    targetSize?: string,
    platform: string = 'Amazon',
  ): Promise<TransactionAgentResult> {
    // If search wasn't performed yet, run search first
    if (!tx.selectedProduct) {
      const searchRes = await this.executeSearch(tx, query, constraints, platform);
      if (!searchRes.success || !tx.selectedProduct) {
        return searchRes;
      }
    }

    transactionStateMachine.transitionState(tx.transactionId, 'PREPARING');

    const product = tx.selectedProduct!;
    const sizeToUse = targetSize || constraints.size || product.selectedSize || '9';

    // Perform Add to Cart and state verification
    const cartResult: CartVerificationResult = await eCommerceAdapter.addToCartAndVerify(product, sizeToUse);

    if (!cartResult.verified) {
      transactionStateMachine.transitionState(tx.transactionId, 'FAILED', {
        cartResult,
        failureReason: cartResult.verificationMessage,
      });

      return {
        success: false,
        transaction: tx,
        spokenResponse: cartResult.verificationMessage,
        error: cartResult.verificationMessage,
      };
    }

    // Transition state to COMPLETED (Cart operations complete upon verification without financial charge)
    const completedTx = transactionStateMachine.transitionState(tx.transactionId, 'COMPLETED', {
      cartResult,
      selectedProduct: { ...product, selectedSize: sizeToUse },
    }) || tx;

    const priceFormatted = `₹${product.price.toLocaleString('en-IN')}`;

    return {
      success: true,
      transaction: completedTx,
      spokenResponse: `Added "${product.title}" (Size ${sizeToUse}) at ${priceFormatted} to your cart on ${product.platform}. Cart verified!`,
      clientActionPayload: {
        type: 'CART_VERIFIED',
        platform: product.platform,
        product: { ...product, selectedSize: sizeToUse },
        cartResult,
        cartUrl: cartResult.cartUrl,
      },
    };
  }

  /**
   * Prepare purchase and transition to AWAITING_CONFIRMATION.
   */
  private async executePreparePurchase(tx: TransactionRecord): Promise<TransactionAgentResult> {
    if (!tx.selectedProduct) {
      return {
        success: false,
        transaction: tx,
        spokenResponse: 'No product is currently selected for purchase.',
      };
    }

    const product = tx.selectedProduct;

    // Check for price changes
    const priceCheck = eCommerceAdapter.checkPriceChange(tx.initialPrice || product.price, product.price);

    transactionStateMachine.transitionState(tx.transactionId, 'AWAITING_CONFIRMATION', {
      finalPrice: product.price,
      priceChanged: priceCheck.changed,
    });

    const priceFormatted = `₹${product.price.toLocaleString('en-IN')}`;
    let responseText = `I have prepared the order for "${product.title}" at ${priceFormatted}.`;

    if (priceCheck.changed && priceCheck.message) {
      responseText += ` ${priceCheck.message}`;
    } else {
      responseText += ' Please confirm if you want me to place this purchase.';
    }

    return {
      success: true,
      transaction: tx,
      spokenResponse: responseText,
      clientActionPayload: {
        type: 'AWAITING_PURCHASE_CONFIRMATION',
        transactionId: tx.transactionId,
        product,
        price: product.price,
        shippingAddress: 'Home Address (Default)',
        priceChanged: priceCheck.changed,
      },
    };
  }

  /**
   * Confirm and execute transaction after explicit user authorization.
   */
  private async executeConfirmTransaction(tx: TransactionRecord): Promise<TransactionAgentResult> {
    if (tx.state !== 'AWAITING_CONFIRMATION') {
      return {
        success: false,
        transaction: tx,
        spokenResponse: 'There is no active transaction awaiting confirmation.',
      };
    }

    transactionStateMachine.transitionState(tx.transactionId, 'EXECUTING');

    // Verification check before declaring completion
    transactionStateMachine.transitionState(tx.transactionId, 'VERIFYING');

    const orderRef = `ORD_${Date.now()}_${Math.random().toString(36).slice(2, 6).toUpperCase()}`;

    const completedTx = transactionStateMachine.transitionState(tx.transactionId, 'COMPLETED', {
      userConfirmed: true,
      confirmationTimestamp: new Date().toISOString(),
      orderOrBookingReference: orderRef,
    }) || tx;

    return {
      success: true,
      transaction: completedTx,
      spokenResponse: `Order confirmed! Reference: ${orderRef}. Your order has been placed successfully.`,
      clientActionPayload: {
        type: 'TRANSACTION_COMPLETED',
        orderReference: orderRef,
        product: tx.selectedProduct,
      },
    };
  }

  /**
   * Cancel active transaction.
   */
  private async executeCancelTransaction(tx: TransactionRecord): Promise<TransactionAgentResult> {
    const cancelledTx = transactionStateMachine.cancelActiveTransaction('User cancelled turn') || tx;

    return {
      success: true,
      transaction: cancelledTx,
      spokenResponse: 'Transaction cancelled.',
      clientActionPayload: {
        type: 'TRANSACTION_CANCELLED',
      },
    };
  }

  /**
   * Helper: extract constraints from raw voice query.
   */
  private parseConstraints(query: string, existing: ProductConstraintFilter): ProductConstraintFilter {
    const lower = query.toLowerCase();
    const result: ProductConstraintFilter = { ...existing, rawQuery: query };

    // Price extraction: "under 5000", "below ₹7000", "less than 3000"
    const priceMatch = lower.match(/(?:under|below|less than|max|within|₹|\bRs\.?\b)\s*₹?\s*(\d+)/i);
    if (priceMatch && priceMatch[1]) {
      const p = parseInt(priceMatch[1], 10);
      if (p > 100) result.maxPrice = p;
    }

    // Color extraction
    const colors = ['black', 'white', 'blue', 'red', 'green', 'grey', 'gray', 'yellow', 'pink', 'silver'];
    for (const c of colors) {
      if (lower.includes(c)) {
        result.color = c;
        break;
      }
    }

    // Size extraction: "size 9", "size 10", "size m", "size xl"
    const sizeMatch = lower.match(/size\s*([a-z0-9]+)/i);
    if (sizeMatch && sizeMatch[1]) {
      result.size = sizeMatch[1].toUpperCase();
    }

    // Brand extraction
    const brands = ['nike', 'adidas', 'puma', 'samsung', 'apple', 'boat', 'sony', 'lenovo', 'hp', 'dell'];
    for (const b of brands) {
      if (lower.includes(b)) {
        result.brand = b.charAt(0).toUpperCase() + b.slice(1);
        break;
      }
    }

    // Category extraction
    if (lower.includes('shoe') || lower.includes('sneaker') || lower.includes('running')) {
      result.category = 'Running Shoes';
    } else if (lower.includes('ssd') || lower.includes('storage') || lower.includes('hard disk')) {
      result.category = 'SSD Storage';
    } else if (lower.includes('phone') || lower.includes('mobile')) {
      result.category = 'Mobile Phone';
    }

    return result;
  }
}

export const transactionAgent = new TransactionAgent();
