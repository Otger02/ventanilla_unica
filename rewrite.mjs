import fs from "fs";

let content = fs.readFileSync("app/api/chat/route.ts", "utf-8");

content = content.replace(
  "Entendido. Soy tu CFO experto en normativa colombiana y tengo tus facturas a la vista. ¿Cuál es tu consulta tributaria o financiera?",
  "Listo. ¿Qué consulta tienes sobre tus cuentas o la normativa?"
);

const oldPromptBlock = [
  "            \"Responde SIEMPRE con una Tabla Markdown estructurada obligatoriamente con las siguientes columnas: Estatus (Emoji ??/??/??), Proveedor, Monto (COP), y Vencimiento.\",",
  "            \"Al final de la lista, debes calcular OBLIGATORIAMENTE y mostrar resaltado el Gran Total Pendiente sumando todos los montos, formateado correctamente en pesos colombianos.\",",
  "            \"Tu tono debe ser resolutivo, profesional y proactivo. Además de la tabla, debes mencionar brevemente una recomendación estratégica sobre qué facturas priorizar sus pagos según el grado de urgimiento y liquidez operativa del mes.\""
].join("\\n");

const newPromptBlock = [
  "            \"Responde SIEMPRE con una Tabla Markdown estructurada obligatoriamente con las siguientes columnas: Estatus (Emoji ??/??/??), Proveedor, Monto (COP), y Vencimiento.\",",
  "            \"Al final de la tabla, debes calcular OBLIGATORIAMENTE el Gran Total Pendiente.\",",
  "            \"NO añadas textos de relleno ni recomendaciones antes o después de la tabla de facturas.\""
].join("\\n");

content = content.replace(oldPromptBlock, newPromptBlock);

const extraRules = `
    const REGLAS_DE_ORO = [
      "REGLAS DE ORO:",
      "- OMITE introducciones como \\"Soy tu CFO\\", \\"Como experto...\\", o \\"He analizado tus documentos\\".",
      "- OMITE confirmaciones de lectura.",
      "- RESPUESTA DIRECTA: Empieza siempre con la información solicitada. Si pregunto por una fecha, la primera palabra de tu respuesta debe ser la fecha o el contexto de la misma.",
      "- TONO: Profesional, técnico y breve. Usa el Calendario 2026 y el Estatuto Tributario como si fueran tu propia memoria, sin citarlos a menos que sea necesario para dar validez (ej: \\"Según el Art. X...\\").",
      "- FORMATO: Manten la tabla Markdown con los emojis (??, ??, ??) solo cuando se listen facturas, sin textos de relleno antes o después.",
    ].join("\\n");

    const fullPrompt = [
      REGLAS_DE_ORO,
      ventanillaUnicaSystemPrompt,`;

content = content.replace("    const fullPrompt = [\r\n      ventanillaUnicaSystemPrompt,", extraRules);
content = content.replace("    const fullPrompt = [\n      ventanillaUnicaSystemPrompt,", extraRules);

fs.writeFileSync("app/api/chat/route.ts", content);
console.log("Replaced via node.");

