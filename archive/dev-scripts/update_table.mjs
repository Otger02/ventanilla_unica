import fs from "fs";
const path = "app/chat/chat-client.tsx";
let content = fs.readFileSync(path, "utf-8");

const startIndex = content.indexOf(`<div className="mt-3 overflow-x-auto rounded-md border border-zinc-200 dark:border-zinc-800">`);
const beforeTable = content.substring(0, startIndex);

const tableEndIndex = content.indexOf("</table>", startIndex);
let endIndex = content.indexOf("</div>", tableEndIndex);
if (endIndex !== -1) endIndex += 6; // include </div>

if (startIndex !== -1 && endIndex !== -1) {
    const afterTable = content.substring(endIndex);
    content = beforeTable + `<div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {invoices.map((invoice) => {
                    const extractionStatus = getInvoiceDisplayStatus(invoice);
                    const dueDate = getInvoiceDueDate(invoice);
                    // Compare dueDate with today
                    const today = new Date();
                    today.setHours(0, 0, 0, 0);
                    let dueColorClass = "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300";
                    let dueLabel = "Al día";
                    if (invoice.payment_status === "paid") {
                      dueColorClass = "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400";
                      dueLabel = "Pagada";
                    } else if (dueDate) {
                      const dDate = new Date(dueDate);
                      dDate.setHours(0, 0, 0, 0);
                      const diffTime = dDate.getTime() - today.getTime();
                      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
                      if (diffDays < 0) {
                        dueColorClass = "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400";
                        dueLabel = "Vencida";
                      } else if (diffDays <= 5) {
                        dueColorClass = "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400";
                        dueLabel = "Vence pronto";
                      } else {
                        dueColorClass = "bg-zinc-100 text-zinc-700 dark:bg-zinc-900/30 dark:text-zinc-400";
                        dueLabel = "Al día";
                      }
                    }

                    return (
                      <Card
                        key={invoice.id}
                        className="flex flex-col rounded-xl border-slate-200 p-4 shadow-sm dark:border-zinc-800"
                      >
                        <div className="mb-4 flex items-start justify-between gap-2">
                          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400">
                            <FileText className="h-5 w-5" />
                          </div>
                          <span
                            className={\`inline-flex items-center rounded-full px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider \${dueColorClass}\`}
                          >
                            {dueLabel}
                          </span>
                        </div>

                        <div className="mb-4">
                          <h3 className="truncate text-base font-semibold text-zinc-900 dark:text-zinc-100" title={invoice.supplier_name || "Proveedor"}>
                            {invoice.supplier_name || "Proveedor desconocido"}
                          </h3>
                          <p className="mt-1 truncate text-xs text-zinc-500 dark:text-zinc-400" title={invoice.filename || ""}>
                            {invoice.filename || "Sin archivo adjunto"}
                          </p>
                        </div>

                        <div className="mb-4">
                          <div className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-100">
                            {invoice.total_cop !== null ? formatCop(invoice.total_cop) : "—"}
                          </div>
                          <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                            Vence: {formatDateOnly(dueDate)}
                          </div>
                        </div>

                        <div className="mt-auto flex flex-col gap-2">
                          <div className="grid grid-cols-2 gap-2">
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="w-full text-xs"
                              onClick={() => void handlePayInvoice(invoice)}
                              disabled={updatingPaymentInvoiceId === invoice.id || processingInvoiceId === invoice.id}
                            >
                              Pagar
                            </Button>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="w-full text-xs"
                              onClick={() => handleReceiptPickerClick(invoice.id)}
                              disabled={uploadingReceiptInvoiceId === invoice.id || updatingPaymentInvoiceId === invoice.id || processingInvoiceId === invoice.id}
                            >
                              {uploadingReceiptInvoiceId === invoice.id ? "Subiendo..." : "Comprobante"}
                            </Button>
                          </div>
                          
                          <div className="grid grid-cols-2 gap-2">
                            <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="w-full text-xs"
                                onClick={() => void loadInvoiceReceipts(invoice)}
                                disabled={uploadingReceiptInvoiceId === invoice.id}
                            >
                                Recibos ({invoice.receipts_count})
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="w-full text-xs"
                              onClick={() => void handleProcessInvoice(invoice.id)}
                              disabled={processingInvoiceId === invoice.id || updatingPaymentInvoiceId === invoice.id}
                            >
                              {processingInvoiceId === invoice.id ? "Procesando..." : "Re-procesar"}
                            </Button>
                          </div>
                          <div className="grid grid-cols-2 gap-2">
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="w-full text-xs"
                              onClick={() => openScheduleModal(invoice)}
                              disabled={updatingPaymentInvoiceId === invoice.id}
                            >
                              Programar
                            </Button>
                            {invoice.payment_status === "scheduled" ? (
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="w-full text-xs"
                                onClick={() => void handleCancelInvoiceSchedule(invoice)}
                                disabled={updatingPaymentInvoiceId === invoice.id}
                              >
                                Cancelar
                              </Button>
                            ) : (
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="w-full text-xs"
                                onClick={() => void handleMarkInvoicePaid(invoice)}
                                disabled={updatingPaymentInvoiceId === invoice.id || invoice.payment_status === "paid"}
                              >
                                {invoice.payment_status === "paid" ? "Pagada" : "Marcar pagada"}
                              </Button>
                            )}
                          </div>
                        </div>
                      </Card>
                    );
                  })}
                </div>` + afterTable;
} else {
   console.log("No table match. start:", startIndex, "end:", endIndex);
}

fs.writeFileSync(path, content);
console.log("Done");

