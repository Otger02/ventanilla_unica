const fs = require('fs');
let content = fs.readFileSync('app/chat/chat-client.tsx', 'utf8');

let pStart = content.indexOf('title="Perfil fiscal"');
let pSectionStart = content.lastIndexOf('<SectionCard', pStart);
let pSectionEnd = content.indexOf('</SectionCard>', pStart) + '</SectionCard>'.length;
console.log("PROFILE:");
console.log(content.substring(pSectionStart, pSectionEnd).slice(0, 100));
console.log(content.substring(pSectionStart, pSectionEnd).slice(-100));

let mStart = content.indexOf('title="Operación Mensual Estimada"');
let mSectionStart = content.lastIndexOf('<SectionCard', mStart);
let mSectionEnd = content.indexOf('</SectionCard>', mStart) + '</SectionCard>'.length;
console.log("\nMENSUA");
console.log(content.substring(mSectionStart, mSectionEnd).slice(0, 100));
console.log(content.substring(mSectionStart, mSectionEnd).slice(-100));
