"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { OperatingPreferences } from "@/lib/invoices/applyOperatingPreferences";

type OperatingPrefsModalProps = {
  current: OperatingPreferences;
  onClose: () => void;
  onSaved: (prefs: OperatingPreferences) => void;
};

export function OperatingPrefsModal({
  current,
  onClose,
  onSaved,
}: OperatingPrefsModalProps) {
  const [viewMode, setViewMode] = useState(current.preferred_view_mode);
  const [style, setStyle] = useState(current.preferred_action_style);
  const [focus, setFocus] = useState(current.preferred_weekly_focus ?? "");
  const [day, setDay] = useState(current.preferred_schedule_day ?? "");
  const [maxCount, setMaxCount] = useState(
    current.max_weekly_execution_count != null ? String(current.max_weekly_execution_count) : "",
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    setSaving(true);
    setError(null);

    const payload: Record<string, unknown> = {
      preferred_view_mode: viewMode,
      preferred_action_style: style,
      preferred_weekly_focus: focus || null,
      preferred_schedule_day: day || null,
      max_weekly_execution_count: maxCount ? parseInt(maxCount, 10) : null,
    };

    try {
      const res = await fetch("/api/operating-preferences", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "Error guardando");
        setSaving(false);
        return;
      }

      const saved = await res.json();
      onSaved(saved as OperatingPreferences);
    } catch {
      setError("Error de conexión");
      setSaving(false);
    }
  }

  const selectClass =
    "w-full rounded-lg border border-border bg-surface-secondary px-3 py-2 text-sm text-foreground";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-md rounded-2xl border border-border bg-surface p-6 shadow-xl mx-4">
        <h3 className="text-base font-semibold text-foreground mb-4">
          Preferencias operativas
        </h3>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-foreground mb-1">
              Modo de vista
            </label>
            <select
              value={viewMode}
              onChange={(e) =>
                setViewMode(e.target.value as OperatingPreferences["preferred_view_mode"])
              }
              className={selectClass}
            >
              <option value="owner">Propietario — foco en ejecución y caja</option>
              <option value="advisor">Asesor — foco en diagnóstico y riesgos</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-foreground mb-1">
              Estilo de acción
            </label>
            <select
              value={style}
              onChange={(e) =>
                setStyle(e.target.value as OperatingPreferences["preferred_action_style"])
              }
              className={selectClass}
            >
              <option value="conservative">Conservador — prioriza revisión</option>
              <option value="balanced">Equilibrado — comportamiento estándar</option>
              <option value="aggressive">Agresivo — prioriza ejecución rápida</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-foreground mb-1">
              Foco semanal
            </label>
            <select
              value={focus}
              onChange={(e) => setFocus(e.target.value)}
              className={selectClass}
            >
              <option value="">Sin preferencia</option>
              <option value="cash">Caja — pagos y flujo</option>
              <option value="compliance">Cumplimiento — datos, comprobantes, IVA</option>
              <option value="cleanup">Limpieza — reducir pendientes</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-foreground mb-1">
              Día preferido para programar
            </label>
            <select
              value={day}
              onChange={(e) => setDay(e.target.value)}
              className={selectClass}
            >
              <option value="">Sin preferencia</option>
              <option value="lunes">Lunes</option>
              <option value="martes">Martes</option>
              <option value="miercoles">Miércoles</option>
              <option value="jueves">Jueves</option>
              <option value="viernes">Viernes</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-foreground mb-1">
              Máximo acciones por semana
            </label>
            <input
              type="number"
              min="1"
              max="50"
              value={maxCount}
              onChange={(e) => setMaxCount(e.target.value)}
              placeholder="Sin límite"
              className={selectClass}
            />
          </div>

          {error && (
            <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
          )}
        </div>

        <div className="flex justify-end gap-2 mt-6">
          <Button variant="outline" size="sm" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button variant="primary" size="sm" onClick={handleSave} disabled={saving}>
            {saving ? "Guardando..." : "Guardar"}
          </Button>
        </div>
      </div>
    </div>
  );
}
