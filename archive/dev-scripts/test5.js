const fs = require('fs');
let content = fs.readFileSync('old_chat.tsx', 'utf8');

let pStart = content.indexOf('title="Perfil fiscal"');
let pSectionStart = content.lastIndexOf('<SectionCard', pStart);
let pSectionEnd = content.indexOf('</SectionCard>', pStart) + '</SectionCard>'.length;
console.log("Profile ends with:", content.substring(pSectionStart, pSectionEnd).slice(-50));

let mStart = content.indexOf('title="Operación Mensual Estimada"');
let mSectionStart = content.lastIndexOf('<SectionCard', mStart);
let mSectionEnd = content.indexOf('</SectionCard>', mStart) + '</SectionCard>'.length;
console.log("Mensual ends with:", content.substring(mSectionStart, mSectionEnd).slice(-50));

let fStart = content.indexOf('title="Facturas"');
let fSectionStart = content.lastIndexOf('<SectionCard', fStart);
let fSectionEnd = content.indexOf('</SectionCard>', fStart) + '</SectionCard>'.length;
console.log("Facturas ends with:", content.substring(fSectionStart, fSectionEnd).slice(-50));
