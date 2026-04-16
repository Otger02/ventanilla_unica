type NoteForPrompt = {
  target_type: string;
  target_id?: string | null;
  author_label: string;
  content: string;
  created_at: string;
};

const TARGET_LABELS: Record<string, string> = {
  invoice: "factura",
  review_queue: "cola de revisión",
  weekly_plan: "plan semanal",
  goal: "meta",
  dashboard: "dashboard",
};

export function buildNotesPromptSection(notes: NoteForPrompt[]): string {
  if (notes.length === 0) return "";

  const lines: string[] = ["NOTAS_OPERATIVAS:"];

  for (const note of notes) {
    const typeLabel = TARGET_LABELS[note.target_type] ?? note.target_type;
    const targetSuffix = note.target_id ? ` (${note.target_id.slice(0, 8)})` : "";
    const date = new Date(note.created_at).toLocaleDateString("es-CO", { day: "numeric", month: "short" });
    lines.push(`- [${typeLabel}${targetSuffix}] ${note.author_label} (${date}): "${note.content}"`);
  }

  lines.push(
    "",
    "INSTRUCCION_NOTAS_OPERATIVAS:",
    "Las notas operativas son contexto proporcionado por el usuario o su equipo.",
    "Úsalas para informar tus recomendaciones y personalizar las respuestas.",
    "No las trates como verdad absoluta — son observaciones subjetivas.",
    "Si una nota contradice datos del sistema, prioriza los datos y menciona la discrepancia.",
  );

  return lines.join("\n");
}
