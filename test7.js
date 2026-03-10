const fs = require('fs');
const content = fs.readFileSync('app/chat/chat-client.tsx', 'utf8');

const returnStatement = /  return \([\s]*<PageShell/g;
const matches = [...content.matchAll(returnStatement)];
const returnStart = matches[matches.length - 1].index;

const returnEndStr = '</PageShell>\n  );\n}';
const endIdx = content.indexOf(returnEndStr, returnStart);

const returnBlock = content.substring(returnStart, endIdx + returnEndStr.length);

fs.writeFileSync('return_block.txt', returnBlock, 'utf8');
console.log("Wrote return_block.txt");
