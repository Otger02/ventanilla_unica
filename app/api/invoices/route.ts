import { NextResponse } from "next/server";

import { createServerSupabaseClient } from "@/lib/supabase/server";

type InvoiceRow = {
  id: string;
  created_at: string;
  status: "pending" | "scheduled" | "paid" | "disputed";
  payment_status: "unpaid" | "scheduled" | "paid";
  due_date: string | null;
  scheduled_payment_date: string | null;
  paid_at: string | null;
  payment_method: "transfer" | "pse" | "cash" | "other" | null;
  payment_notes: string | null;
  payment_url: string | null;
  supplier_portal_url: string | null;
  last_payment_opened_at: string | null;
  total_cop: number | null;
  supplier_name: string | null;
  extracted_at: string | null;
  extraction_confidence: Record<string, unknown> | null;
  extraction_raw: Record<string, unknown> | null;
};

type InvoiceFileRow = {
  invoice_id: string;
  storage_path: string;
  size_bytes: number;
  created_at: string;
};

type InvoiceListItem = InvoiceRow & {
  filename: string | null;
  size_bytes: number | null;
};

export async function GET() {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "No autenticado." }, { status: 401 });
  }

  const { data, error } = await supabase
    .from("invoices")
    .select("id, created_at, status, payment_status, due_date, scheduled_payment_date, paid_at, payment_method, payment_notes, payment_url, supplier_portal_url, last_payment_opened_at, total_cop, supplier_name, extracted_at, extraction_confidence, extraction_raw")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) {
    return NextResponse.json({ error: "No se pudo listar facturas." }, { status: 500 });
  }

  const invoices = (data ?? []) as InvoiceRow[];
  const invoiceIds = invoices.map((invoice) => invoice.id);

  const latestFileByInvoiceId = new Map<string, InvoiceFileRow>();

  if (invoiceIds.length > 0) {
    const { data: filesData, error: filesError } = await supabase
      .from("invoice_files")
      .select("invoice_id, storage_path, size_bytes, created_at")
      .eq("user_id", user.id)
      .in("invoice_id", invoiceIds)
      .order("created_at", { ascending: false });

    if (filesError) {
      return NextResponse.json({ error: "No se pudo listar archivos de facturas." }, { status: 500 });
    }

    for (const fileRow of (filesData ?? []) as InvoiceFileRow[]) {
      if (!latestFileByInvoiceId.has(fileRow.invoice_id)) {
        latestFileByInvoiceId.set(fileRow.invoice_id, fileRow);
      }
    }
  }

  const items: InvoiceListItem[] = invoices.map((invoice) => {
    const file = latestFileByInvoiceId.get(invoice.id);
    const filename = file?.storage_path ? file.storage_path.split("/").pop() ?? null : null;

    return {
      ...invoice,
      filename,
      size_bytes: file?.size_bytes ?? null,
    };
  });

  return NextResponse.json({ invoices: items });
}
