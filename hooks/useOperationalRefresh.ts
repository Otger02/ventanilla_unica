"use client";

import { useCallback } from "react";

/**
 * Centralized refresh helper.
 *
 * After any mutation (pay, schedule, edit, upload receipt) the UI needs to
 * refresh invoices, alerts, and optionally the review queue. This hook wraps
 * those fetches into a single `refreshAll()` call so every action path gets
 * the same consistency guarantees.
 *
 * Refreshers are provided by the host component — this hook just orchestrates.
 */

export type RefreshFns = {
  /** Reload the invoices list (always needed after mutations). */
  loadInvoices: () => Promise<void>;
  /** Reload alert counts (optional — only when available). */
  loadAlerts?: () => Promise<void>;
};

export function useOperationalRefresh(fns: RefreshFns) {
  const refreshAll = useCallback(async () => {
    const tasks: Promise<void>[] = [fns.loadInvoices()];
    if (fns.loadAlerts) tasks.push(fns.loadAlerts());
    await Promise.allSettled(tasks);
  }, [fns]);

  return { refreshAll };
}
