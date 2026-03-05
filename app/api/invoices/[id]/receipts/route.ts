import { NextResponse } from "next/server";

import { createServerSupabaseClient } from "@/lib/supabase/server";

type ReceiptsRouteContext = {
  params: Promise<{
    id: string;
  }>;
};

type InvoiceReceiptListItem = {
  id: string;
  original_filename: string | null;
  created_at: string;
};

export async function GET(_request: Request, context: ReceiptsRouteContext) {
  const { id: invoiceId } = await context.params;

  if (!invoiceId) {
    return NextResponse.json({ error: "Id de factura inválido." }, { status: 400 });
  }

  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "No autenticado." }, { status: 401 });
  }

  const { data: invoice, error: invoiceError } = await supabase
    .from("invoices")
    .select("id")
    .eq("id", invoiceId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (invoiceError) {
    return NextResponse.json({ error: "No se pudo consultar la factura." }, { status: 500 });
  }

  if (!invoice) {
    return NextResponse.json({ error: "Factura no encontrada." }, { status: 404 });
  }

  const { data, error } = await supabase
    .from("invoice_receipts")
    .select("id, original_filename, created_at")
    .eq("user_id", user.id)
    .eq("invoice_id", invoiceId)
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: "No se pudo listar comprobantes." }, { status: 500 });
  }

  return NextResponse.json({
    receipts: (data ?? []) as InvoiceReceiptListItem[],
  });
}
