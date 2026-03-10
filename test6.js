const fs = require('fs');
const content = fs.readFileSync('old_chat.tsx', 'utf16le');
const regex = /<SectionCard[^>]*title="([^"]+)"/g;
let match;
while((match = regex.exec(content)) !== null) console.log(match[1]);
