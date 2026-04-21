import fs from "fs";

const content = fs.readFileSync("app/api/invoices/[id]/receipts/upload/route.ts", "utf-8");
fs.writeFileSync("app/api/receipts/upload/route.ts", content);
console.log("Copied route!");
