import fs from "fs";

let c = fs.readFileSync("app/api/chat/route.ts", "utf8");

const replacement = `if (pendingInvoicesList && pendingInvoicesList.length > 0) {
        promptSections.push(
          [
            "ALL_INVOICES_LIST_REAL_DATA:",
            JSON.stringify(pendingInvoicesList, null, 2),
            "INSTRUCCION_FACTURAS_PENDIENTES_Y_PAGADAS:",
            "Usa esta lista para responder si el usuario pregunta 'qué facturas tengo', '¿qué debo?', 'cuánto debo' o temas relacionados con pagos.",
            "Importante: Las facturas con payment_status 'paid' ya están pagadas. Las 'unpaid' o 'scheduled' están pendientes.",
            "El CFO SIEMPRE debe incluir y decir exactamente esta frase en su respuesta: 'Has pagado $X y te faltan $Y por pagar', donde $X es la suma de las facturas pagadas y $Y es la suma de las facturas pendientes. Formatea todo en pesos colombianos.",
            "HOY ES EL 6 DE MARZO DE 2026. Al listar facturas pendientes actúa con visión de CFO y aplica la siguiente lógica de semáforo priorizando pagos:",
            "🔴 Vencida: Si la due_date es estricta o anterior al 6 de marzo de 2026.",
            "🟡 Urgente: Si la due_date tiene vencimiento dentro de los próximos 5 días (hasta el 11 de marzo).",
            "🟢 Al día: Si tiene más de 5 días de plazo.",
            "Responde SIEMPRE con una Tabla Markdown estructurada obligatoriamente con las siguientes columnas para las pendientes: Estatus (Emoji 🔴/🟡/🟢), Proveedor, Monto (COP), y Vencimiento.",
            "Al final de la tabla, debes calcular OBLIGATORIAMENTE el Gran Total Pendiente.",
            "NO añadas textos de relleno ni recomendaciones antes o después de la tabla de facturas."
          ].join("\\n")
        );
      }`;

const regex = /if \(pendingInvoicesList && pendingInvoicesList\.length > 0\) \{[\s\S]*?\]\.join\("\\n"\)\s*\);\s*\}/;

c = c.replace(regex, replacement);

fs.writeFileSync("app/api/chat/route.ts", c, "utf8");
console.log("Done!");

