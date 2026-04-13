import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Count receipts per invoice by querying invoice_receipts.
 * Returns a Map from invoice_id to count.
 */
export async function getReceiptsCounts(
  supabase: SupabaseClient,
  invoiceIds: string[],
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (invoiceIds.length === 0) return counts;

  // Batch in chunks of 200 to avoid query-param limits
  const CHUNK = 200;
  for (let i = 0; i < invoiceIds.length; i += CHUNK) {
    const batch = invoiceIds.slice(i, i + CHUNK);
    const { data } = await supabase
      .from("invoice_receipts")
      .select("invoice_id")
      .in("invoice_id", batch);

    if (data) {
      for (const row of data as { invoice_id: string }[]) {
        counts.set(row.invoice_id, (counts.get(row.invoice_id) ?? 0) + 1);
      }
    }
  }

  return counts;
}
