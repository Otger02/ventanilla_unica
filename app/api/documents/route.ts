import { NextResponse } from "next/server";

import { isDemoModeEnabled } from "@/lib/demo-mode";
import { createServerSupabaseClient } from "@/lib/supabase/server";

const validCategories = ["tax", "deductions", "hiring", "finance"] as const;
type DocumentCategory = (typeof validCategories)[number];

type DocumentRow = {
  id: string;
  title: string;
  category: DocumentCategory;
  storage_path: string;
  created_at: string;
};

function sanitizeFileName(name: string) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9.-]/g, "-")
    .replace(/-+/g, "-");
}

export async function GET() {
  if (isDemoModeEnabled()) {
    return NextResponse.json({ error: "No disponible en DEMO_MODE." }, { status: 404 });
  }

  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "No autenticado." }, { status: 401 });
  }

  const { data, error } = await supabase
    .from("documents")
    .select("id, title, category, storage_path, created_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: "No se pudo listar documentos." }, { status: 500 });
  }

  return NextResponse.json({ documents: (data ?? []) as DocumentRow[] });
}

export async function POST(request: Request) {
  if (isDemoModeEnabled()) {
    return NextResponse.json({ error: "No disponible en DEMO_MODE." }, { status: 404 });
  }

  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "No autenticado." }, { status: 401 });
  }

  const formData = await request.formData();

  const title = String(formData.get("title") ?? "").trim();
  const categoryValue = String(formData.get("category") ?? "").trim();
  const file = formData.get("file");

  if (!title) {
    return NextResponse.json({ error: "El titulo es obligatorio." }, { status: 400 });
  }

  if (!validCategories.includes(categoryValue as DocumentCategory)) {
    return NextResponse.json({ error: "Categoria invalida." }, { status: 400 });
  }

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Debes adjuntar un archivo PDF." }, { status: 400 });
  }

  const isPdfByType = file.type === "application/pdf";
  const isPdfByName = file.name.toLowerCase().endsWith(".pdf");

  if (!isPdfByType && !isPdfByName) {
    return NextResponse.json({ error: "Solo se permiten archivos PDF." }, { status: 400 });
  }

  const safeFileName = sanitizeFileName(file.name || "document.pdf");
  const storagePath = `${user.id}/${Date.now()}-${safeFileName}`;
  const fileBuffer = Buffer.from(await file.arrayBuffer());

  const { error: uploadError } = await supabase.storage
    .from("docs")
    .upload(storagePath, fileBuffer, {
      contentType: "application/pdf",
      upsert: false,
    });

  if (uploadError) {
    return NextResponse.json({ error: "No se pudo subir el archivo a Storage." }, { status: 500 });
  }

  const { data: document, error: insertError } = await supabase
    .from("documents")
    .insert({
      title,
      category: categoryValue,
      storage_path: storagePath,
      user_id: user.id,
    })
    .select("id, title, category, storage_path, created_at")
    .single();

  if (insertError) {
    await supabase.storage.from("docs").remove([storagePath]);
    return NextResponse.json({ error: "No se pudo guardar metadata del documento." }, { status: 500 });
  }

  return NextResponse.json({ document });
}
