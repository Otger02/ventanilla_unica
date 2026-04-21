import fs from "fs";
let c = fs.readFileSync("app/api/receipts/upload/route.ts", "utf8");

c = c.replace(/if \(!auditResult\.audit\.match\) \{[\s\S]*?\{ status: 400 \},\n\s*\);\n\s*\}/, `  const expectedTotal = Number(invoice.total_cop) || 0;
  const extractedTotal = Number(auditResult.audit.monto_pagado) || 0;

  if (expectedTotal > 0 && extractedTotal > 0 && Math.abs(expectedTotal - extractedTotal) > 1) {
    return NextResponse.json(
      {
        error: \`El monto del comprobante ($\${extractedTotal}) no coincide con el valor de la factura ($\${expectedTotal})\`,
        audit: auditResult.audit,
      },
      { status: 400 },
    );
  }

  if (!auditResult.audit.match) {
    return NextResponse.json(
      {
        error: \`Validación fallida: \${auditResult.audit.reason}\`,
        audit: auditResult.audit,
      },
      { status: 400 },
    );
  }`);

fs.writeFileSync("app/api/receipts/upload/route.ts", c, "utf8");
console.log("patched!");
