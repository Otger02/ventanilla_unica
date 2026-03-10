const fs = require('fs');

const content = fs.readFileSync('old_chat.tsx', 'utf8');

const returnStart = content.indexOf('  return (\n    <PageShell');
if (returnStart === -1) {
  console.log("Not found.");
  process.exit(1);
}

const beforeReturn = content.substring(0, returnStart);

console.log("Found return start at:", returnStart);
