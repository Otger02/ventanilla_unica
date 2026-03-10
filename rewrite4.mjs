import fs from "fs";
let content = fs.readFileSync("app/chat/chat-client.tsx", "utf-8");

content = content.replace(
  /const response = await fetch\(`\/api\/invoices\/\${invoiceId}\/receipts\/upload`, {/g,
  `formData.append("invoiceId", invoiceId);\n        const response = await fetch(\`/api/receipts/upload\`, {`
);

fs.writeFileSync("app/chat/chat-client.tsx", content);
console.log("Updated API route in frontend");
