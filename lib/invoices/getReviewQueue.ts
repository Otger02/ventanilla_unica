import type { SupabaseClient } from "@supabase/supabase-js";
import { getReceiptsCounts } from "./getReceiptsCounts";
import {
  classifyInvoices,
  type ClassifyInvoiceRow,
  type ReviewQueueItem,
} from "./review-queue-core";

// Re-export everything from core so existing imports still work
export {
  classifyInvoice,
  classifyInvoices,
  getTopPriorityActions,
  REVIEW_PRIORITY_ORDER,
  PRIORITY_LABELS,
  ACTION_LABELS,
} from "./review-queue-core";
export type {
  ReviewPriority,
  ReviewAction,
  ReviewQueueItem,
  ClassifyInvoiceRow,
  ConfidenceLevel,
  ConfidenceResult,
} from "./review-queue-core";

/**
 * Full review queue: query invoices + receipt counts, classify, sort.
 */
export async function getReviewQueue(params: {
  supabase: SupabaseClient;
  userId: string;
  limit?: number;
}): Promise<{ items: ReviewQueueItem[]; total: number }> {
  const { supabase, userId, limit } = params;

  const { data: invoices, error } = await supabase
    .from("invoices")
    .select("id, supplier_name, invoice_number, total_cop, iva_cop, due_date, payment_status, data_quality_status, vat_status")
    .eq("user_id", userId);

  if (error) throw error;

  const rows = (invoices ?? []) as ClassifyInvoiceRow[];
  const receiptCounts = await getReceiptsCounts(supabase, rows.map((r) => r.id));

  const result = classifyInvoices(rows, receiptCounts);

  if (limit && result.items.length > limit) {
    return { items: result.items.slice(0, limit), total: result.total };
  }

  return result;
}
