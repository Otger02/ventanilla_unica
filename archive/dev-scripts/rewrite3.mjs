import fs from "fs";
let content = fs.readFileSync("app/chat/chat-client.tsx", "utf-8");

content = content.replace(
  /import { FileText } from "lucide-react";/,
  `import { FileText, CheckCircle } from "lucide-react";`
);

content = content.replace(
  /<Button\s+type="button"\s+variant="outline"\s+size="sm"\s+className="w-full text-xs"\s+onClick=\{[^}]+\}\s+disabled=\{uploadingReceiptInvoiceId === invoice.id \|\| updatingPaymentInvoiceId === invoice.id \|\| processingInvoiceId === invoice.id\}\s+>\s+\{[^}]+\}\s+<\/Button>/,
  `<Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="w-full text-xs flex items-center justify-center gap-1"
                                onClick={() => handleReceiptPickerClick(invoice.id)}
                                disabled={uploadingReceiptInvoiceId === invoice.id || updatingPaymentInvoiceId === invoice.id || processingInvoiceId === invoice.id}
                              >
                                <CheckCircle className="h-3.5 w-3.5" />
                                {uploadingReceiptInvoiceId === invoice.id ? "Registrando..." : "Registrar Pago"}
                              </Button>`
);

fs.writeFileSync("app/chat/chat-client.tsx", content);
console.log("Replaced chat-client.tsx UI buttons");
