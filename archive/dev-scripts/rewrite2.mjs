import fs from "fs";

let content = fs.readFileSync("app/api/chat/route.ts", "utf-8");

content = content.replace(/Entendido\..*?tributaria o financiera\?"/gs, "Listo. ¿Qué consulta tienes sobre tus cuentas o la normativa?\"");

const oldPrompt1 = `            "Responde SIEMPRE con una Tabla Markdown estructurada\\r\\nobligatoriamente con las siguientes columnas: Estatus (Emoji 🔴/🟡/🟢),\\r\\nProveedor, Monto (COP), y Vencimiento.",\\r\\n            "Al final de la lista, debes calcular OBLIGATORIAMENTE y mostrar\\r\\nresaltado el Gran Total Pendiente sumando todos los montos, formateado\\r\\ncorrectamente en pesos colombianos.",\\r\\n            "Tu tono debe ser resolutivo, profesional y proactivo. Además de\\r\\nla tabla, debes mencionar brevemente una recomendación estratégica sobre\\r\\nqué facturas priorizar sus pagos según el grado de urgimiento y liquidez\\r\\noperativa del mes."`;

const newPrompt1 = `            "Responde SIEMPRE con una Tabla Markdown estructurada obligatoriamente con las siguientes columnas: Estatus (Emoji 🔴/🟡/🟢), Proveedor, Monto (COP), y Vencimiento.",
            "Al final de la tabla, debes calcular OBLIGATORIAMENTE el Gran Total Pendiente.",
            "NO añadas textos de relleno ni recomendaciones antes o después de la tabla de facturas."`;

content = content.replace(/Responde SIEMPRE con una Tabla Markdown .*?operativa del mes/s, `"Responde SIEMPRE con una Tabla Markdown estructurada obligatoriamente con las siguientes columnas: Estatus (Emoji 🔴/🟡/🟢), Proveedor, Monto (COP), y Vencimiento.",\n            "Al final de la tabla, debes calcular OBLIGATORIAMENTE el Gran Total Pendiente.",\n            "NO añadas textos de relleno ni recomendaciones antes o después de la tabla de facturas.`);

const reglas = `

    const REGLAS_DE_ORO = [
      "REGLAS DE ORO:",
      "- OMITE introducciones como \\"Soy tu CFO\\", \\"Como experto...\\", o \\"He analizado tus documentos\\".",
      "- OMITE confirmaciones de lectura.",
      "- RESPUESTA DIRECTA: Empieza siempre con la información solicitada. Si pregunto por una fecha, la primera palabra de tu respuesta debe ser la fecha o el contexto de la misma.",
      "- TONO: Profesional, técnico y breve. Usa el Calendario 2026 y el Estatuto Tributario como si fueran tu propia memoria, sin citarlos a menos que sea necesario para dar validez (ej: \\"Según el Art. X...\\").",
      "- FORMATO: Manten la tabla Markdown con los emojis (🔴, 🟡, 🟢) solo cuando se listen facturas, sin textos de relleno antes o después.",
    ].join("\\n");

    const fullPrompt = [
      REGLAS_DE_ORO,`;

content = content.replace(/const fullPrompt = \[/g, reglas);

fs.writeFileSync("app/api/chat/route.ts", "\uFEFF" + content, "utf-8"); // Ensure BOM to force utf8 for next if needed, or just write without bom but in utf8 encoding in node
// Let's just write standard utf-8
fs.writeFileSync("app/api/chat/route.ts", content, "utf8");

console.log("Replaced via node 2 with correct encoding.");
