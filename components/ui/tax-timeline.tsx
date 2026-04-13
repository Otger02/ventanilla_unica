"use client";

import { useEffect, useState } from "react";
import { AlertCircle, Calendar, CheckCircle2 } from "lucide-react";

type TaxEvent = {
  title: string;
  dueDate: string;
  description: string;
  traduccion_humana?: string;
  pasos_a_seguir?: string[];
  link_accion?: string;
};

export function TaxTimeline() {
  const [events, setEvents] = useState<TaxEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchTimeline() {
      try {
        const res = await fetch("/api/taxes/timeline");
        if (res.status === 404) {
          // No RUT configured yet, just ignore gracefully
          setLoading(false);
          return;
        }
        if (!res.ok) {
          throw new Error("No se pudieron cargar los vencimientos.");
        }
        const data = await res.json();
        if (data.events) {
          setEvents(data.events);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Error cargando calendario.");
      } finally {
        setLoading(false);
      }
    }

    void fetchTimeline();
  }, []);

  if (loading) {
    return (
      <div className="animate-pulse flex space-x-4 bg-surface-secondary p-4 rounded-md mb-4 h-16 items-center">
        <div className="h-4 bg-border rounded w-5/6"></div>
      </div>
    );
  }

  if (events.length === 0 && !error) {
    return null; // Don't show anything if profile is not fully configured
  }

  const currentDate = new Date("2026-03-09"); // Current project context date

  const getStatusColor = (dueDateStr: string) => {
    const due = new Date(dueDateStr);
    const diffTime = due.getTime() - currentDate.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    if (diffDays < 5) return "bg-red-100 border-red-500 text-red-800 dark:bg-red-950 dark:border-red-800 dark:text-red-200";
    if (diffDays <= 15) return "bg-amber-100 border-amber-500 text-amber-800 dark:bg-amber-950 dark:border-amber-800 dark:text-amber-200";
    return "bg-emerald-100 border-emerald-500 text-emerald-800 dark:bg-emerald-950 dark:border-emerald-800 dark:text-emerald-200";
  };
  
  const getStatusIcon = (dueDateStr: string) => {
    const due = new Date(dueDateStr);
    const diffTime = due.getTime() - currentDate.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    if (diffDays < 5) return <AlertCircle className="h-5 w-5 mr-3 shrink-0" />;
    if (diffDays <= 15) return <Calendar className="h-5 w-5 mr-3 shrink-0" />;
    return <CheckCircle2 className="h-5 w-5 mr-3 shrink-0" />;
  };

  return (
    <div className="mb-6">
      <h2 className="text-sm font-semibold mb-2 text-foreground">Próximos Vencimientos DIAN</h2>
      {error ? (
        <div className="text-sm text-red-600 bg-red-50 p-3 rounded-md dark:bg-red-900/30 dark:text-red-400">
          {error}
        </div>
      ) : (
        <div className="flex flex-col space-y-2">
          {events.map((ev, idx) => (
            <div 
              key={idx} 
              className={`flex items-start border-l-4 p-3 rounded-r-md shadow-sm ${getStatusColor(ev.dueDate)}`}
            >
              {getStatusIcon(ev.dueDate)}
              <div>
                <p className="font-semibold text-sm">{ev.title}</p>
                <div className="flex gap-2 items-center text-xs opacity-80 mt-1">
                  <span className="font-medium bg-black/10 px-2 py-0.5 rounded-full">{ev.dueDate}</span>
                  <span className="line-clamp-1">{ev.description}</span>
                </div>
                {ev.traduccion_humana && (
                  <p className="mt-2 text-sm italic opacity-90 border-l-2 border-black/20 pl-2">"{ev.traduccion_humana}"</p>
                )}
                {ev.pasos_a_seguir && ev.pasos_a_seguir.length > 0 && (
                  <ul className="mt-2 text-xs list-disc list-inside pl-4 opacity-80 space-y-1">
                    {ev.pasos_a_seguir.map((paso, i) => (
                      <li key={i}>{paso}</li>
                    ))}
                  </ul>
                )}
                {ev.link_accion && (
                  <a href={ev.link_accion} target="_blank" rel="noreferrer" className="inline-block mt-3 text-xs font-semibold underline opacity-90 hover:opacity-100">
                    → Ver más detalles o pagar
                  </a>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
