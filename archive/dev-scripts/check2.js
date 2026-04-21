const fs = require('fs');
const content = fs.readFileSync('app/chat/chat-client.tsx', 'utf8');
let idx = content.indexOf('title="Facturas"');
console.log(content.slice(idx - 50, idx + 200));
