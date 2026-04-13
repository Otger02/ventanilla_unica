import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";

// IMPORTANTE: Esto evita que Next.js intente cachear la ruta estáticamente,
// lo cual rompe la autenticación por cookies.
export const dynamic = "force-dynamic";

export async function GET() {
  console.log("📥 [GET /api/invoices] Iniciando consulta de facturas...");

  try {
    const supabase = await createServerSupabaseClient();
    
    // 1. Verificar Usuario
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      console.warn("❌ [GET /api/invoices] Usuario no autenticado o error de sesión.");
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // 2. Consultar Base de Datos — ordenar por vencimiento para priorizar pagos
    const { data: invoices, error: dbError } = await supabase
      .from("invoices")
      .select("*")
      .eq("user_id", user.id)
      .order("due_date", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: false });

    if (dbError) {
      console.error("🔥 [GET /api/invoices] Error de Supabase:", dbError.message);
      return NextResponse.json({ error: dbError.message }, { status: 500 });
    }

    console.log(`✅ [GET /api/invoices] Se encontraron ${invoices?.length || 0} facturas.`);
    
    return NextResponse.json(invoices || []);

  } catch (error: any) {
    console.error("🔥 [GET /api/invoices] Error Crítico del Servidor:", error);
    return NextResponse.json(
      { error: "Internal Server Error", details: error.message }, 
      { status: 500 }
    );
  }
}
