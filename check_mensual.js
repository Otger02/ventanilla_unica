const fs = require('fs');
const content = fs.readFileSync('app/chat/chat-client.tsx', 'utf8');
console.log(content.match(/title="[^"]*mensual[^"]*"/ig));
