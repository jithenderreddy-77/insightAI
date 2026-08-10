'use client';

/**
 * components/transaction-preview-card.tsx
 *
 * Rich interactive transaction preview card for Insight AI.
 * Renders product search results, constraint match indicators,
 * cart addition status, price change warnings, and confirmation buttons.
 */

import React, { useState } from 'react';
import {
  ShoppingBag,
  ShoppingCart,
  CheckCircle2,
  AlertTriangle,
  ExternalLink,
  ShieldCheck,
  Tag,
  DollarSign,
  Send,
  XCircle,
  Truck,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { CandidateProduct, CartVerificationResult, TransactionRecord } from '@/lib/brain/transaction-agent/types';

export interface TransactionPreviewCardProps {
  transaction: TransactionRecord;
  onConfirm?: (tx: TransactionRecord) => void;
  onAddToCart?: (tx: TransactionRecord, size?: string) => void;
  onCancel?: (tx: TransactionRecord) => void;
}

export function TransactionPreviewCard({
  transaction,
  onConfirm,
  onAddToCart,
  onCancel,
}: TransactionPreviewCardProps) {
  const [selectedSize, setSelectedSize] = useState<string>(
    transaction.constraints?.size || transaction.selectedProduct?.selectedSize || '9',
  );
  const [isLoading, setIsLoading] = useState(false);

  const product = transaction.selectedProduct;
  const cartResult = transaction.cartResult;
  const constraints = transaction.constraints;

  if (!product) {
    return (
      <div className="p-4 rounded-2xl border border-slate-800 bg-slate-900/90 text-white space-y-2">
        <div className="flex items-center gap-2 text-amber-400 font-semibold text-xs">
          <AlertTriangle className="w-4 h-4" />
          <span>Shopping Query</span>
        </div>
        <p className="text-xs text-slate-300">Searching for: {transaction.constraints?.rawQuery || 'Products'}</p>
      </div>
    );
  }

  const priceFormatted = `₹${product.price.toLocaleString('en-IN')}`;
  const origPriceFormatted = product.originalPrice ? `₹${product.originalPrice.toLocaleString('en-IN')}` : null;

  const isCartVerified = cartResult && cartResult.verified;
  const isAwaitingConfirmation = transaction.state === 'AWAITING_CONFIRMATION';
  const isCompleted = transaction.state === 'COMPLETED';

  const handleAction = async (action: 'confirm' | 'add_to_cart' | 'cancel') => {
    setIsLoading(true);
    try {
      if (action === 'confirm') {
        onConfirm?.(transaction);
      } else if (action === 'add_to_cart') {
        onAddToCart?.(transaction, selectedSize);
      } else {
        onCancel?.(transaction);
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="my-3 rounded-2xl border border-indigo-500/20 bg-gradient-to-b from-slate-900/95 to-slate-950/95 backdrop-blur-xl p-4 shadow-xl text-white space-y-3">
      {/* Header Badge */}
      <div className="flex items-center justify-between border-b border-slate-800/80 pb-2.5">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg bg-indigo-500/10 border border-indigo-500/20 text-indigo-400">
            <ShoppingBag className="w-4 h-4" />
          </div>
          <div>
            <span className="text-xs font-bold text-slate-200 uppercase tracking-wider">
              {product.platform} Order Preview
            </span>
            <div className="text-[10px] text-slate-400">
              State: <span className="font-semibold text-indigo-400">{transaction.state}</span>
            </div>
          </div>
        </div>
        <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 flex items-center gap-1">
          <ShieldCheck className="w-3 h-3" />
          VERIFIED SELLER
        </span>
      </div>

      {/* Product Details */}
      <div className="flex gap-3 items-start">
        <div className="w-16 h-16 rounded-xl bg-slate-800 border border-slate-700/60 flex items-center justify-center shrink-0">
          <ShoppingBag className="w-8 h-8 text-indigo-400/60" />
        </div>
        <div className="flex-1 space-y-1">
          <h4 className="text-xs font-bold text-slate-100 line-clamp-2">{product.title}</h4>
          <div className="flex items-center gap-2 text-xs">
            <span className="font-bold text-emerald-400 text-sm">{priceFormatted}</span>
            {origPriceFormatted && (
              <span className="text-[11px] text-slate-500 line-through">{origPriceFormatted}</span>
            )}
            {product.brand && (
              <span className="px-1.5 py-0.5 rounded bg-slate-800 text-[10px] text-slate-300 font-mono">
                {product.brand}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Constraint Matching Badges */}
      <div className="flex flex-wrap gap-1.5 pt-1">
        {constraints.color && (
          <span className="px-2 py-0.5 rounded-md bg-slate-800/80 border border-slate-700 text-[10px] text-slate-300 flex items-center gap-1">
            <Tag className="w-2.5 h-2.5 text-indigo-400" />
            Color: <span className="font-semibold text-white">{constraints.color}</span>
            <CheckCircle2 className="w-3 h-3 text-emerald-400 ml-0.5" />
          </span>
        )}
        {constraints.maxPrice && (
          <span className="px-2 py-0.5 rounded-md bg-slate-800/80 border border-slate-700 text-[10px] text-slate-300 flex items-center gap-1">
            <DollarSign className="w-2.5 h-2.5 text-emerald-400" />
            Max: <span className="font-semibold text-white">₹{constraints.maxPrice}</span>
            <CheckCircle2 className="w-3 h-3 text-emerald-400 ml-0.5" />
          </span>
        )}
        {product.availableSizes && product.availableSizes.length > 0 && (
          <div className="w-full flex items-center gap-2 mt-1">
            <span className="text-[11px] text-slate-400 font-medium">Select Size:</span>
            <div className="flex gap-1">
              {product.availableSizes.map((sz) => (
                <button
                  key={sz}
                  onClick={() => setSelectedSize(sz)}
                  className={`px-2 py-0.5 rounded text-[11px] font-mono font-bold transition-all ${
                    selectedSize === sz
                      ? 'bg-indigo-600 text-white shadow-md shadow-indigo-500/20'
                      : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                  }`}
                >
                  {sz}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Price Change Warning */}
      {transaction.priceChanged && (
        <div className="p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
          <span>Price updated during checkout preview. Please re-verify the new amount.</span>
        </div>
      )}

      {/* Cart Verification Status */}
      {isCartVerified && (
        <div className="p-2.5 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            <span className="font-medium">{cartResult.verificationMessage}</span>
          </div>
          {cartResult.cartUrl && (
            <a
              href={cartResult.cartUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 text-[10px] text-indigo-400 hover:underline shrink-0"
            >
              View Cart <ExternalLink className="w-3 h-3" />
            </a>
          )}
        </div>
      )}

      {/* Action Buttons */}
      {!isCompleted && (
        <div className="flex gap-2 justify-end pt-2 border-t border-slate-800/80">
          <Button
            onClick={() => handleAction('cancel')}
            variant="outline"
            disabled={isLoading}
            className="border-slate-700 text-slate-300 hover:bg-slate-800 text-xs h-8 px-3 gap-1"
          >
            <XCircle className="w-3.5 h-3.5" />
            Cancel
          </Button>

          {!isCartVerified && (
            <Button
              onClick={() => handleAction('add_to_cart')}
              disabled={isLoading}
              className="bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold h-8 px-3 gap-1.5 shadow-md shadow-indigo-500/20"
            >
              <ShoppingCart className="w-3.5 h-3.5" />
              Add Size {selectedSize} to Cart
            </Button>
          )}

          {isAwaitingConfirmation && (
            <Button
              onClick={() => handleAction('confirm')}
              disabled={isLoading}
              className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold h-8 px-3 gap-1.5 shadow-md shadow-emerald-500/20"
            >
              <Send className="w-3.5 h-3.5" />
              Confirm Purchase
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
