"use client";

import type { ReviewQueueItem } from "@/lib/invoices/review-queue-core";
import { Button } from "@/components/ui/button";

type BulkActionBarProps = {
  selectedCount: number;
  selectedItems: ReviewQueueItem[];
  onSchedule: () => void;
  onReviewSequential: () => void;
  onDeselectAll: () => void;
};

export function BulkActionBar({
  selectedCount,
  selectedItems,
  onSchedule,
  onReviewSequential,
  onDeselectAll,
}: BulkActionBarProps) {
  const canSchedule = selectedItems.some((item) =>
    item.available_actions.includes("schedule_payment"),
  );
  const canReview = selectedItems.some((item) =>
    item.available_actions.includes("review_invoice"),
  );

  // Confidence summary
  const confCounts = selectedItems.reduce(
    (acc, item) => {
      const levels = Object.values(item.action_confidence).map((r) => r.level);
      if (levels.includes("blocked")) acc.blocked++;
      else if (levels.includes("review")) acc.review++;
      else acc.safe++;
      return acc;
    },
    { safe: 0, review: 0, blocked: 0 },
  );

  const hasBlocked = confCounts.blocked > 0;

  return (
    <div className="sticky bottom-0 flex items-center gap-3 rounded-xl border border-accent/30 bg-accent/5 p-3 mt-3">
      <div className="flex flex-col gap-0.5">
        <span className="text-sm font-medium text-foreground">
          {selectedCount} seleccionada{selectedCount !== 1 ? "s" : ""}
        </span>
        <span className="text-[10px] text-muted flex gap-2">
          {confCounts.safe > 0 && <span className="text-emerald-600 dark:text-emerald-400">{confCounts.safe} segura{confCounts.safe !== 1 ? "s" : ""}</span>}
          {confCounts.review > 0 && <span className="text-amber-600 dark:text-amber-400">{confCounts.review} a revisar</span>}
          {confCounts.blocked > 0 && <span className="text-red-600 dark:text-red-400">{confCounts.blocked} bloqueada{confCounts.blocked !== 1 ? "s" : ""}</span>}
        </span>
      </div>
      <div className="flex-1" />
      <Button
        variant="primary"
        size="sm"
        className="text-xs"
        disabled={!canSchedule || hasBlocked}
        onClick={onSchedule}
        title={hasBlocked ? "Hay facturas bloqueadas en la selección" : undefined}
      >
        Programar pago
      </Button>
      <Button
        variant="outline"
        size="sm"
        className="text-xs"
        disabled={!canReview}
        onClick={onReviewSequential}
      >
        Revisar secuencial
      </Button>
      <Button
        variant="ghost"
        size="sm"
        className="text-xs"
        onClick={onDeselectAll}
      >
        Deseleccionar
      </Button>
    </div>
  );
}
