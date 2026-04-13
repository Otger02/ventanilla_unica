"use client";

import { useCallback, useState } from "react";

/**
 * Selection state for review queue bulk actions.
 * Tracks a Set of invoice_ids; the dashboard calls cleanStale
 * explicitly after each queue refresh.
 */
export function useReviewQueueSelection() {
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const selectedCount = selected.size;

  const isSelected = useCallback(
    (id: string) => selected.has(id),
    [selected],
  );

  const toggle = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const selectAll = useCallback(
    (items: { invoice_id: string }[]) => {
      setSelected(new Set(items.map((i) => i.invoice_id)));
    },
    [],
  );

  const deselectAll = useCallback(() => {
    setSelected(new Set());
  }, []);

  const isAllSelected = useCallback(
    (items: { invoice_id: string }[]): boolean => {
      if (items.length === 0) return false;
      return items.every((i) => selected.has(i.invoice_id));
    },
    [selected],
  );

  /** Remove IDs that no longer exist in the current queue. */
  const cleanStale = useCallback((currentIds: Set<string>) => {
    setSelected((prev) => {
      const next = new Set([...prev].filter((id) => currentIds.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, []);

  return {
    selected,
    selectedCount,
    isSelected,
    toggle,
    selectAll,
    deselectAll,
    isAllSelected,
    cleanStale,
  };
}
