"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Copy, Check } from "lucide-react";

type CreateSharedViewModalProps = {
  onClose: () => void;
  onCreated: () => void;
};

export function CreateSharedViewModal({ onClose, onCreated }: CreateSharedViewModalProps) {
  const [email, setEmail] = useState("");
  const [accessMode, setAccessMode] = useState<"read_only" | "advisor_limited">("read_only");
  const [expiresAt, setExpiresAt] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createdLink, setCreatedLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function handleCreate() {
    setError(null);
    if (!email.includes("@") || email.length < 5) {
      setError("Email inválido");
      return;
    }

    setSaving(true);
    try {
      const body: Record<string, unknown> = {
        shared_with_email: email.trim(),
        access_mode: accessMode,
      };
      if (expiresAt) body.expires_at = new Date(expiresAt).toISOString();

      const res = await fetch("/api/shared-views", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.error ?? "Error creando enlace");
        return;
      }

      const data = await res.json();
      setCreatedLink(`${window.location.origin}/shared/${data.token}`);
    } catch {
      setError("Error de red");
    } finally {
      setSaving(false);
    }
  }

  function handleCopy() {
    if (!createdLink) return;
    navigator.clipboard.writeText(createdLink).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-md rounded-2xl border border-border bg-surface p-6 shadow-xl mx-4">
        <h3 className="text-lg font-semibold text-foreground mb-4">Crear enlace compartido</h3>

        {createdLink ? (
          <div className="space-y-4">
            <p className="text-sm text-muted">Enlace creado. Cópialo y compártelo:</p>
            <div className="flex items-center gap-2 rounded-lg border border-border bg-surface-secondary p-3">
              <p className="text-xs text-foreground truncate flex-1 font-mono">{createdLink}</p>
              <button onClick={handleCopy} className="shrink-0 p-1.5 rounded-md hover:bg-surface text-muted hover:text-foreground transition-colors">
                {copied ? <Check className="w-4 h-4 text-emerald-500" /> : <Copy className="w-4 h-4" />}
              </button>
            </div>
            <div className="flex justify-end">
              <Button variant="primary" size="sm" onClick={onCreated}>Listo</Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-muted mb-1">Email del destinatario</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-accent/50"
                placeholder="contador@ejemplo.com"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-muted mb-1">Tipo de acceso</label>
              <select
                value={accessMode}
                onChange={(e) => setAccessMode(e.target.value as "read_only" | "advisor_limited")}
                className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-accent/50"
              >
                <option value="read_only">Solo lectura</option>
                <option value="advisor_limited">Asesor (limitado)</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-muted mb-1">
                Fecha de expiración <span className="text-muted">(opcional)</span>
              </label>
              <input
                type="date"
                value={expiresAt}
                onChange={(e) => setExpiresAt(e.target.value)}
                min={new Date().toISOString().split("T")[0]}
                className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-accent/50"
              />
            </div>

            {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}

            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={onClose}>Cancelar</Button>
              <Button variant="primary" size="sm" onClick={handleCreate} disabled={saving}>
                {saving ? "Creando..." : "Crear enlace"}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
