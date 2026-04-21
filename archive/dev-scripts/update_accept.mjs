import fs from "fs";
let c = fs.readFileSync("app/chat/chat-client.tsx", "utf8");
c = c.replace(/accept="\.pdf,application\/pdf"/g, `accept=".pdf,application/pdf,.png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp"`);
fs.writeFileSync("app/chat/chat-client.tsx", c);
console.log("Updated chat-client.tsx");
