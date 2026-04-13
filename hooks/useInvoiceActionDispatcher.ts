"use client";

import { useCallback } from "react";
import {
  type ReviewAction,
  type ReviewActionContext,
  type ReviewActionResult,
  canRunReviewAction,
  getActionFeedbackMessage,
} from "@/lib/invoices/review-actions";

// ─── Types ───

/** Minimal invoice shape required by the dispatcher. */
export type DispatchableInvoice = {
  id: string;
  payment_status: string | null;
  payment_url: string | null;
  supplier_portal_url: string | null;
  due_date: string | null;
  data_quality_status: string | null;
  vat_status: string | null;
};

/** Callbacks the host component provides for each action. */
export type ActionHandlers = {
  handlePayInvoice: (invoice: DispatchableInvoice) => void | Promise<void>;
  openScheduleModal: (invoice: DispatchableInvoice) => void;
  openDetailsModal: (invoice: DispatchableInvoice) => void;
  openReceiptsModal: (invoice: DispatchableInvoice) => void | Promise<void>;
};

function toActionContext(inv: DispatchableInvoice): ReviewActionContext {
  return {
    invoice_id: inv.id,
    payment_status: inv.payment_status,
    payment_url: inv.payment_url,
    supplier_portal_url: inv.supplier_portal_url,
    due_date: inv.due_date,
    data_quality_status: inv.data_quality_status,
    vat_status: inv.vat_status,
  };
}

// ─── Hook ───

/**
 * Shared action dispatcher used by both the chat page (URL params + recommended
 * action cards) and any future surface that needs to execute review actions.
 *
 * Returns a `dispatch(action, invoiceId)` function that:
 *  1. Finds the invoice in the provided list.
 *  2. Validates the action via `canRunReviewAction`.
 *  3. Calls the appropriate handler.
 *  4. Returns a `ReviewActionResult` with feedback message.
 */
export function useInvoiceActionDispatcher(
  invoices: DispatchableInvoice[],
  handlers: ActionHandlers,
) {
  const dispatch = useCallback(
    (action: ReviewAction, invoiceId: string): ReviewActionResult => {
      const invoice = invoices.find((i) => i.id === invoiceId);

      if (!invoice) {
        return {
          success: false,
          message: "Factura no encontrada.",
        };
      }

      const ctx = toActionContext(invoice);

      if (!canRunReviewAction(action, ctx)) {
        return {
          success: false,
          message: "Acción no disponible para esta factura.",
        };
      }

      switch (action) {
        case "pay_now":
          void handlers.handlePayInvoice(invoice);
          break;
        case "schedule_payment":
          handlers.openScheduleModal(invoice);
          break;
        case "review_invoice":
          handlers.openDetailsModal(invoice);
          break;
        case "upload_receipt":
          void handlers.openReceiptsModal(invoice);
          break;
        default:
          return {
            success: false,
            message: "Acción no reconocida.",
          };
      }

      return {
        success: true,
        message: getActionFeedbackMessage(action),
        requiresRefresh: action === "pay_now" || action === "schedule_payment",
      };
    },
    [invoices, handlers],
  );

  return { dispatch };
}
