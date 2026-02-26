import { NextResponse } from "next/server";

import { createServerSupabaseClient } from "@/lib/supabase/server";

type InvoiceRow = {
  id: string;
  created_at: string;
  status: "pending" | "scheduled" | "paid" | "disputed";
  total_cop: number | null;
  supplier_name: string | null;
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
    .select("id, created_at, status, total_cop, supplier_name")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) {
    return NextResponse.json({ error: "No se pudo listar facturas." }, { status: 500 });
  }

  const invoices = (data ?? []) as InvoiceRow[];
  const invoiceIds = invoices.map((invoice) => invoice.id);

  let latestFileByInvoiceId = new Map<string, InvoiceFileRow>();

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
