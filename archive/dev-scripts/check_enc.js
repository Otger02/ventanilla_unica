const fs = require('fs');
const content = fs.readFileSync('app/chat/chat-client.tsx', 'utf16le');
if (content.indexOf('PageShell') === -1) {
  console.log("WAIT, old_chat was utf8 or utf16?");
}
