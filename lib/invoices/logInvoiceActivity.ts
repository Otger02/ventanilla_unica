import type { SupabaseClient } from "@supabase/supabase-js";

export type InvoiceActivity =
  | "uploaded"
  | "processed"
  | "quality_updated"
  | "payment_opened"
  | "scheduled"
  | "rescheduled"
  | "marked_paid"
  | "receipt_uploaded"
  | "manually_edited"
  | "assignment_changed";

export async function logInvoiceActivity(
  supabase: SupabaseClient,
  params: {
    invoice_id: string;
    user_id: string;
    activity: InvoiceActivity;
    metadata?: Record<string, unknown>;
  }
): Promise<void> {
  await supabase.from("invoice_activity_log").insert({
    invoice_id: params.invoice_id,
    user_id: params.user_id,
    activity: params.activity,
    metadata: params.metadata ?? {},
  });
}
