"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { CreateSharedViewModal } from "./CreateSharedViewModal";
import { Link2, Trash2, ToggleLeft, ToggleRight, Plus, Copy, Check } from "lucide-react";

type SharedViewRow = {
  id: string;
  shared_with_email: string;
  access_mode: "read_only" | "advisor_limited";
  token: string;
  is_active: boolean;
  created_at: string;
  expires_at: string | null;
};

const modeLabels: Record<string, string> = {
  read_only: "Solo lectura",
  advisor_limited: "Asesor",
};

export function SharedAccessSection() {
  const [views, setViews] = useState<SharedViewRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const loadViews = useCallback(async () => {
    try {
      const res = await fetch("/api/shared-views");
      if (res.ok) {
        const data = await res.json();
        setViews(data.items ?? []);
      }
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void loadViews(); }, [loadViews]);

  async function handleToggle(id: string, currentActive: boolean) {
    setViews((prev) => prev.map((v) => v.id === id ? { ...v, is_active: !currentActive } : v));
    try {
      await fetch(`/api/shared-views/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_active: !currentActive }),
      });
    } catch { loadViews(); }
  }

  async function handleDelete(id: string) {
    setViews((prev) => prev.filter((v) => v.id !== id));
    try {
      await fetch(`/api/shared-views/${id}`, { method: "DELETE" });
    } catch { loadViews(); }
  }

  function copyLink(token: string, id: string) {
    const url = `${window.location.origin}/shared/${token}`;
    navigator.clipboard.writeText(url).then(() => {
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    });
  }

  const formatDate = (iso: string) => new Date(iso).toLocaleDateString("es-CO", { day: "numeric", month: "short", year: "numeric" });

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
          <Link2 className="w-5 h-5 text-muted" />
          Acceso compartido
        </h2>
        <Button variant="outline" size="sm" className="text-xs gap-1" onClick={() => setShowModal(true)}>
          <Plus className="w-3 h-3" />
          Crear enlace
        </Button>
      </div>

      {loading ? (
        <p className="text-xs text-muted animate-pulse">Cargando...</p>
      ) : views.length === 0 ? (
        <p className="text-xs text-muted">No hay vistas compartidas. Crea una para compartir con un asesor o tercero.</p>
      ) : (
        <div className="space-y-2">
          {views.map((view) => (
            <div key={view.id} className={`flex items-center gap-3 rounded-xl border p-3 ${view.is_active ? "border-border bg-surface" : "border-border bg-surface-secondary opacity-60"}`}>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <p className="text-sm font-medium text-foreground truncate">{view.shared_with_email}</p>
                  <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${
                    view.access_mode === "advisor_limited"
                      ? "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300"
                      : "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400"
                  }`}>
                    {modeLabels[view.access_mode]}
                  </span>
                  {!view.is_active && (
                    <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300">
                      Desactivado
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-muted">
                  Creado {formatDate(view.created_at)}
                  {view.expires_at && ` · Expira ${formatDate(view.expires_at)}`}
                </p>
              </div>
              <div className="flex-none flex items-center gap-1">
                <button
                  onClick={() => copyLink(view.token, view.id)}
                  className="p-1.5 rounded-md hover:bg-surface-secondary text-muted hover:text-foreground transition-colors"
                  title="Copiar enlace"
                >
                  {copiedId === view.id ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
                </button>
                <button
                  onClick={() => handleToggle(view.id, view.is_active)}
                  className="p-1.5 rounded-md hover:bg-surface-secondary text-muted hover:text-foreground transition-colors"
                  title={view.is_active ? "Desactivar" : "Activar"}
                >
                  {view.is_active ? <ToggleRight className="w-4 h-4 text-emerald-500" /> : <ToggleLeft className="w-4 h-4" />}
                </button>
                <button
                  onClick={() => handleDelete(view.id)}
                  className="p-1.5 rounded-md hover:bg-red-50 dark:hover:bg-red-950/30 text-muted hover:text-red-600 dark:hover:text-red-400 transition-colors"
                  title="Eliminar"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {showModal && (
        <CreateSharedViewModal
          onClose={() => setShowModal(false)}
          onCreated={() => { setShowModal(false); loadViews(); }}
        />
      )}
    </div>
  );
}
