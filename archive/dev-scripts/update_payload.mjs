import fs from "fs";

let c = fs.readFileSync("app/api/receipts/upload/route.ts", "utf8");

c = c.replace(/const \{ error: updateInvoiceError \} = await supabase\s*\.from\("invoices"\)\s*\.update\(\{[\s\S]*?\}\)\s*\.eq\("id", invoiceId\)\s*\.eq\("user_id", user\.id\);/, `const { error: updateInvoiceError } = await supabase
    .from("invoices")
    .update({
      payment_status: "paid",
      paid_at: invoice.paid_at ?? auditResult.audit.fecha_pago ?? new Date().toISOString(),
      updated_at: new Date().toISOString(),
      payment_notes: auditResult.audit.referencia ? \`Referencia de pago ext: \${auditResult.audit.referencia}\` : null,
    })
    .eq("id", invoiceId)
    .eq("user_id", user.id);`);

fs.writeFileSync("app/api/receipts/upload/route.ts", c, "utf8");
console.log("patched!");
