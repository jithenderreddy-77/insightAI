/**
 * lib/brain/tools/transaction-tool.ts
 *
 * Self-describing Transaction Tool for the Brain Orchestrator.
 * Exposes shopping search, filtering, add to cart, and booking commands
 * to the LLM agent via Zod schema validation.
 */

import { z } from 'zod';
import type { ToolDefinition, ToolResult, ToolContext } from '../tool-registry';
import { transactionAgent } from '../transaction-agent/transaction-agent';

const transactionParamsSchema = z.object({
  intent: z.enum(['shopping', 'cart_operation', 'ride_booking', 'travel_booking', 'ticket_booking', 'general_transaction']),
  action: z.enum(['search', 'add_to_cart', 'prepare_purchase', 'confirm_transaction', 'cancel_transaction']),
  query: z.string().describe('Original user command query string'),
  brand: z.string().optional().describe('Brand name constraint if requested'),
  category: z.string().optional().describe('Product category or type'),
  color: z.string().optional().describe('Requested product color'),
  size: z.string().optional().describe('Requested clothing or shoe size'),
  maxPrice: z.number().optional().describe('Maximum budget or price constraint in INR'),
  platform: z.string().optional().describe('Preferred platform (e.g. Amazon, Flipkart, Uber, Rapido)'),
  targetSize: z.string().optional().describe('Size to select for cart addition'),
  transactionId: z.string().optional().describe('Active transaction ID if confirming/cancelling'),
});

export type TransactionParams = z.infer<typeof transactionParamsSchema>;

export const transactionTool: ToolDefinition<TransactionParams> = {
  name: 'transaction_action',
  description:
    'Perform online shopping searches, product constraint filtering (brand, size, color, max price), variant selection, Add to Cart actions, cart verification, and ride/booking workflows.',
  parameterDescriptions: {
    intent: 'Transaction category: "shopping", "cart_operation", "ride_booking", "travel_booking"',
    action: 'Action to execute: "search", "add_to_cart", "prepare_purchase", "confirm_transaction", "cancel_transaction"',
    query: 'Raw user query or product search string',
    brand: 'Requested brand (e.g. Nike, Puma, Samsung)',
    category: 'Product category (e.g. running shoes, SSD)',
    color: 'Requested color (e.g. black, white)',
    size: 'Requested size (e.g. 9, 10, M, XL)',
    maxPrice: 'Maximum budget constraint in INR',
    platform: 'Preferred shopping or ride platform (Amazon, Flipkart, Uber, Rapido)',
    targetSize: 'Specific size to select when adding to cart',
  },
  parameterSchema: transactionParamsSchema,
  execute: async (params: TransactionParams, context: ToolContext): Promise<ToolResult> => {
    try {
      const res = await transactionAgent.handleCommand({
        intent: params.intent,
        action: params.action,
        query: params.query || context.transcript,
        constraints: {
          brand: params.brand,
          category: params.category,
          color: params.color,
          size: params.size,
          maxPrice: params.maxPrice,
          rawQuery: params.query,
        },
        targetSize: params.targetSize || params.size,
        platform: params.platform || 'Amazon',
        transactionId: params.transactionId,
      });

      return {
        success: res.success,
        data: {
          transaction: res.transaction,
          spokenResponse: res.spokenResponse,
          summary: res.spokenResponse,
        },
        error: res.error,
        clientAction: res.clientActionPayload
          ? {
              type: 'APP_ACTION',
              payload: res.clientActionPayload,
            }
          : undefined,
      };
    } catch (err: any) {
      console.error('Transaction tool execution error:', err);
      return {
        success: false,
        error: err.message || 'Transaction processing failed',
      };
    }
  },
};
