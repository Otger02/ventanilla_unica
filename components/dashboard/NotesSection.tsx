"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Pencil, Trash2, ChevronDown, ChevronUp } from "lucide-react";
import type { OperationalNote } from "@/lib/notes/types";

type NotesSectionProps = {
  targetType: string;
  targetId: string | null;
  readOnly?: boolean;
  singleNoteMode?: boolean;
  notes?: OperationalNote[];
};

export function NotesSection({ targetType, targetId, readOnly, singleNoteMode, notes: preloaded }: NotesSectionProps) {
  const [notes, setNotes] = useState<OperationalNote[]>(preloaded ?? []);
  const [loading, setLoading] = useState(!preloaded);
  const [newContent, setNewContent] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState("");
  const [expanded, setExpanded] = useState(false);

  const fetchNotes = useCallback(async () => {
    try {
      const params = new URLSearchParams({ target_type: targetType });
      if (targetId) params.set("target_id", targetId);
      const res = await fetch(`/api/notes?${params}`);
      if (res.ok) {
        const data = await res.json();
        setNotes(data.notes ?? []);
      }
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, [targetType, targetId]);

  useEffect(() => {
    if (!preloaded) void fetchNotes();
  }, [fetchNotes, preloaded]);

  async function handleAdd() {
    const trimmed = newContent.trim();
    if (!trimmed) return;
    setSaving(true);
    try {
      const res = await fetch("/api/notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: trimmed, target_type: targetType, target_id: targetId }),
      });
      if (res.ok) {
        setNewContent("");
        setShowAdd(false);
        await fetchNotes();
      }
    } catch { /* silent */ }
    finally { setSaving(false); }
  }

  async function handleEdit(id: string) {
    const trimmed = editContent.trim();
    if (!trimmed) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/notes/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: trimmed }),
      });
      if (res.ok) {
        setEditingId(null);
        setEditContent("");
        await fetchNotes();
      }
    } catch { /* silent */ }
    finally { setSaving(false); }
  }

  async function handleDelete(id: string) {
    setNotes((prev) => prev.filter((n) => n.id !== id));
    try {
      await fetch(`/api/notes/${id}`, { method: "DELETE" });
    } catch { void fetchNotes(); }
  }

  const formatDate = (iso: string) =>
    new Date(iso).toLocaleDateString("es-CO", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

  if (loading) return <p className="text-[11px] text-muted animate-pulse">Cargando notas...</p>;

  // singleNoteMode: show latest prominently + expand toggle
  if (singleNoteMode) {
    const latest = notes[0];
    const rest = notes.slice(1);
    return (
      <div className="mt-1.5">
        {latest ? (
          <div className="rounded-lg border border-border bg-surface-secondary p-2.5">
            {editingId === latest.id && !readOnly ? (
              <div className="space-y-1.5">
                <textarea
                  value={editContent}
                  onChange={(e) => setEditContent(e.target.value)}
                  rows={2}
                  maxLength={2000}
                  className="w-full rounded border border-border bg-surface px-2 py-1.5 text-xs text-foreground outline-none focus:ring-1 focus:ring-accent/50 resize-none"
                />
                <div className="flex gap-1">
                  <Button variant="primary" size="sm" className="text-[10px] px-2 py-0.5" onClick={() => handleEdit(latest.id)} disabled={saving}>Guardar</Button>
                  <Button variant="ghost" size="sm" className="text-[10px] px-2 py-0.5" onClick={() => setEditingId(null)}>Cancelar</Button>
                </div>
              </div>
            ) : (
              <div>
                <p className="text-xs text-foreground">{latest.content}</p>
                <div className="flex items-center justify-between mt-1">
                  <p className="text-[10px] text-muted">{latest.author_label} · {formatDate(latest.created_at)}</p>
                  {!readOnly && (
                    <div className="flex gap-0.5">
                      <button onClick={() => { setEditingId(latest.id); setEditContent(latest.content); }} className="p-0.5 text-muted hover:text-foreground"><Pencil className="w-3 h-3" /></button>
                      <button onClick={() => handleDelete(latest.id)} className="p-0.5 text-muted hover:text-red-500"><Trash2 className="w-3 h-3" /></button>
                    </div>
                  )}
                </div>
              </div>
            )}

            {rest.length > 0 && (
              <>
                <button onClick={() => setExpanded(!expanded)} className="flex items-center gap-1 mt-1.5 text-[10px] text-muted hover:text-foreground">
                  {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                  {expanded ? "Ocultar" : `Ver ${rest.length} más`}
                </button>
                {expanded && (
                  <div className="mt-1.5 space-y-1.5 border-t border-border pt-1.5">
                    {rest.map((note) => (
                      <NoteRow key={note.id} note={note} readOnly={readOnly} formatDate={formatDate} editingId={editingId} editContent={editContent} saving={saving} onStartEdit={(n) => { setEditingId(n.id); setEditContent(n.content); }} onCancelEdit={() => setEditingId(null)} onSaveEdit={handleEdit} onDelete={handleDelete} onEditContentChange={setEditContent} />
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        ) : null}

        {!readOnly && (
          showAdd ? (
            <div className="mt-1.5 space-y-1.5">
              <textarea
                value={newContent}
                onChange={(e) => setNewContent(e.target.value)}
                rows={2}
                maxLength={2000}
                placeholder="Agregar nota..."
                className="w-full rounded border border-border bg-surface px-2 py-1.5 text-xs text-foreground outline-none focus:ring-1 focus:ring-accent/50 resize-none"
              />
              <div className="flex gap-1">
                <Button variant="primary" size="sm" className="text-[10px] px-2 py-0.5" onClick={handleAdd} disabled={saving || !newContent.trim()}>Guardar</Button>
                <Button variant="ghost" size="sm" className="text-[10px] px-2 py-0.5" onClick={() => { setShowAdd(false); setNewContent(""); }}>Cancelar</Button>
              </div>
            </div>
          ) : (
            <button onClick={() => setShowAdd(true)} className="text-[10px] text-muted hover:text-foreground mt-1">
              + Agregar nota
            </button>
          )
        )}
      </div>
    );
  }

  // Full list mode (invoice detail)
  return (
    <div className="space-y-2">
      {!readOnly && (
        <div className="space-y-1.5">
          <textarea
            value={newContent}
            onChange={(e) => setNewContent(e.target.value)}
            rows={2}
            maxLength={2000}
            placeholder="Agregar nota..."
            className="w-full rounded border border-border bg-surface-secondary px-2.5 py-1.5 text-xs text-foreground outline-none focus:ring-1 focus:ring-accent/50 resize-none"
          />
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-muted">{newContent.length}/2000</span>
            <Button variant="primary" size="sm" className="text-[10px] px-2 py-0.5" onClick={handleAdd} disabled={saving || !newContent.trim()}>
              {saving ? "Guardando..." : "Agregar"}
            </Button>
          </div>
        </div>
      )}

      {notes.length === 0 && (
        <p className="text-[11px] text-muted">Sin notas.</p>
      )}

      {notes.map((note) => (
        <NoteRow key={note.id} note={note} readOnly={readOnly} formatDate={formatDate} editingId={editingId} editContent={editContent} saving={saving} onStartEdit={(n) => { setEditingId(n.id); setEditContent(n.content); }} onCancelEdit={() => setEditingId(null)} onSaveEdit={handleEdit} onDelete={handleDelete} onEditContentChange={setEditContent} />
      ))}
    </div>
  );
}

function NoteRow({ note, readOnly, formatDate, editingId, editContent, saving, onStartEdit, onCancelEdit, onSaveEdit, onDelete, onEditContentChange }: {
  note: OperationalNote; readOnly?: boolean; formatDate: (s: string) => string;
  editingId: string | null; editContent: string; saving: boolean;
  onStartEdit: (n: OperationalNote) => void; onCancelEdit: () => void;
  onSaveEdit: (id: string) => void; onDelete: (id: string) => void;
  onEditContentChange: (v: string) => void;
}) {
  if (editingId === note.id && !readOnly) {
    return (
      <div className="space-y-1">
        <textarea
          value={editContent}
          onChange={(e) => onEditContentChange(e.target.value)}
          rows={2}
          maxLength={2000}
          className="w-full rounded border border-border bg-surface px-2 py-1.5 text-xs text-foreground outline-none focus:ring-1 focus:ring-accent/50 resize-none"
        />
        <div className="flex gap-1">
          <Button variant="primary" size="sm" className="text-[10px] px-2 py-0.5" onClick={() => onSaveEdit(note.id)} disabled={saving}>Guardar</Button>
          <Button variant="ghost" size="sm" className="text-[10px] px-2 py-0.5" onClick={onCancelEdit}>Cancelar</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-start gap-2">
      <div className="flex-1 min-w-0">
        <p className="text-xs text-foreground">{note.content}</p>
        <p className="text-[10px] text-muted">{note.author_label} · {formatDate(note.created_at)}</p>
      </div>
      {!readOnly && (
        <div className="flex-none flex gap-0.5 mt-0.5">
          <button onClick={() => onStartEdit(note)} className="p-0.5 text-muted hover:text-foreground"><Pencil className="w-3 h-3" /></button>
          <button onClick={() => onDelete(note.id)} className="p-0.5 text-muted hover:text-red-500"><Trash2 className="w-3 h-3" /></button>
        </div>
      )}
    </div>
  );
}
