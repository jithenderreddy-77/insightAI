/**
 * lib/brain/transaction-agent/types.ts
 *
 * Data models, transaction states, platform classification, product filter criteria,
 * and verification contracts for Insight's Transaction & Booking Agent.
 */

// ---------------------------------------------------------------------------
// Platform Classification
// ---------------------------------------------------------------------------

export type PlatformSupportStatus =
  | 'SUPPORTED_AND_TESTED'
  | 'SUPPORTED_BUT_UNTESTED'
  | 'PARTIALLY_SUPPORTED'
  | 'NOT_SUPPORTED';

export type TransactionIntent =
  | 'shopping'
  | 'cart_operation'
  | 'ride_booking'
  | 'travel_booking'
  | 'ticket_booking'
  | 'general_transaction';

// ---------------------------------------------------------------------------
// Transaction State Machine States
// ---------------------------------------------------------------------------

export type TransactionState =
  | 'DISCOVERING'
  | 'SEARCHING'
  | 'COMPARING'
  | 'SELECTING'
  | 'PREPARING'
  | 'AWAITING_CONFIRMATION'
  | 'EXECUTING'
  | 'VERIFYING'
  | 'COMPLETED'
  | 'FAILED'
  | 'RECOVERING'
  | 'CANCELLED';

// ---------------------------------------------------------------------------
// Product Filters & Constraint Criteria (E-Commerce)
// ---------------------------------------------------------------------------

export interface ProductConstraintFilter {
  category?: string;
  brand?: string;
  model?: string;
  color?: string;
  size?: string;
  capacity?: string;
  quantity?: number;
  maxPrice?: number;
  minPrice?: number;
  currency?: string;
  seller?: string;
  rawQuery?: string;
}

export interface CandidateProduct {
  id: string;
  title: string;
  platform: 'Amazon' | 'Flipkart' | 'Myntra' | 'TataCLiQ' | 'GenericWeb';
  price: number;
  originalPrice?: number;
  currency: string;
  url: string;
  rating?: number;
  reviewCount?: number;
  thumbnailUrl?: string;
  brand?: string;
  color?: string;
  availableSizes?: string[];
  selectedSize?: string;
  seller?: string;
  inStock: boolean;
  /** Verification flag checking if candidate satisfies all mandatory user criteria */
  matchedConstraints: {
    colorMatch: boolean;
    sizeMatch: boolean;
    priceMatch: boolean;
    brandMatch: boolean;
  };
}

export interface CartVerificationResult {
  verified: boolean;
  itemCount: number;
  matchedProductTitle?: string;
  matchedSize?: string;
  matchedColor?: string;
  matchedPrice?: number;
  verificationMessage: string;
  cartUrl?: string;
}

// ---------------------------------------------------------------------------
// Ride & Location Criteria
// ---------------------------------------------------------------------------

export interface LocationResolution {
  raw: string;
  resolvedAddress?: string;
  source: 'current_location' | 'memory_saved' | 'geocoded' | 'user_input';
  lat?: number;
  lng?: number;
}

export interface RideOption {
  id: string;
  platform: 'Uber' | 'Rapido' | 'Ola';
  rideType: string;
  estimatedFare: number;
  currency: string;
  etaMinutes: number;
  estimatedDurationMinutes?: number;
  pickupLocation: LocationResolution;
  destination: LocationResolution;
}

// ---------------------------------------------------------------------------
// Active Transaction Record & Idempotency Store
// ---------------------------------------------------------------------------

export interface TransactionRecord {
  transactionId: string;
  attemptId: string;
  userId: string;
  intent: TransactionIntent;
  platform: string;
  platformStatus: PlatformSupportStatus;
  state: TransactionState;
  createdAt: string;
  updatedAt: string;
  expiresAt?: string;
  constraints: ProductConstraintFilter;
  selectedProduct?: CandidateProduct;
  cartResult?: CartVerificationResult;
  rideOption?: RideOption;
  initialPrice?: number;
  finalPrice?: number;
  priceChanged?: boolean;
  userConfirmed?: boolean;
  confirmationTimestamp?: string;
  failureReason?: string;
  orderOrBookingReference?: string;
  clientActionPayload?: Record<string, any>;
}
