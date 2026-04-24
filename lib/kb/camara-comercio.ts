import type { CfoKbSnippet } from "./cfo-estrategias";

export const KB_CC_SNIPPETS: CfoKbSnippet[] = [
  {
    id: "cc-crear-usuario-sii",
    keywords: [
      "crear usuario",
      "usuario sii",
      "sii",
      "cuenta camara",
      "registro camara",
      "cuenta virtual",
      "acceso virtual",
      "plataforma camara",
    ],
    title: "Crear usuario SII (Cámara de Comercio)",
    content:
      "Para hacer trámites virtuales en la Cámara de Comercio necesitas usuario SII (Sistema Integrado de Información).\n" +
      "Pasos:\n" +
      "1. Ir a cccartagena.org.co → Trámites en Línea → Crear Usuario SII\n" +
      "2. Ingresar tipo y número de identificación + datos personales (email, celular, dirección)\n" +
      "3. Responder cuestionario de preguntas reto (información bancaria/sociodemográfica vía CONFECAMARAS)\n" +
      "4. Llega un correo con clave temporal en rojo → hacer clic en 'CONFIRMO LA SOLICITUD DE REGISTRO' (esta clave NO sirve para entrar)\n" +
      "5. Llega un segundo correo con clave segura → hacer clic en 'VERIFICAR ESTE MENSAJE Y ACTIVAR CREDENCIALES'\n" +
      "6. Ya puedes iniciar sesión con email + clave segura\n" +
      "Importante: el usuario SII tiene cobertura nacional; si eres persona jurídica, registra datos del representante legal (no el NIT).",
  },
  {
    id: "cc-renovacion-matricula",
    keywords: [
      "renovar matricula",
      "renovacion matricula",
      "renovacion mercantil",
      "matricula mercantil",
      "renovar registro",
      "registro mercantil",
      "camara de comercio",
      "vencimiento matricula",
      "renovacion anual",
    ],
    title: "Renovación matrícula mercantil (virtual)",
    content:
      "La matrícula mercantil se renueva cada año (enero-marzo).\n" +
      "Pasos:\n" +
      "1. cccartagena.org.co → Trámites Virtuales → Renovación Virtual\n" +
      "2. Login con email, documento y clave SII\n" +
      "3. Buscar expediente por número de matrícula (ver formato abajo)\n" +
      "4. Ingresar valor de activos (sin puntos ni comas) y número de empleados (≠ 0)\n" +
      "5. El sistema calcula el valor a pagar → diligenciar formularios → guardar → verificar PDF\n" +
      "6. Firma electrónica → pago por PSE o volante de pago\n" +
      "7. El sistema envía radicación + factura al correo\n" +
      "Formato del número de matrícula: omitir '09' al inicio, sin guiones. ESAL comienza con 'S0'.\n" +
      "Errores comunes: empleados = 0 bloquea el trámite; si modificas la liquidación después de guardar formularios, debes reiniciar.\n" +
      "El pago es proporcional al valor total de activos del negocio.",
  },
  {
    id: "cc-requisitos-especiales",
    keywords: [
      "ley 1780",
      "empresa joven",
      "uso de suelos",
      "actividades restringidas",
      "bar",
      "discoteca",
      "ciiu 5630",
      "ciiu 9609",
      "requisitos camara",
      "documentos renovacion",
    ],
    title: "Requisitos especiales en renovación CC",
    content:
      "Situaciones que requieren documentos adicionales en la renovación:\n" +
      "• Actividades CIIU 5630 (bar/restaurante con licor) o 9609 (servicios personales): certificado de uso de suelos de Planeación Municipal.\n" +
      "• Disminución de activos respecto al año anterior: estado de situación financiera + estado de resultados con corte al 31 de diciembre.\n" +
      "• Ley 1780 (empresa joven, 18-35 años): relación de trabajadores, certificación de aportes a seguridad social, estados financieros, certificación de titularidad y copias de documentos de socios menores de 35 años.\n" +
      "Condición Ley 1780: persona natural 18-35 años con máx. 50 trabajadores y activos ≤ 5.000 SMMLV; o sociedad donde ≥ 51% de participación pertenece a socios 18-35 años.",
  },
  {
    id: "cc-rues-y-alcance",
    keywords: [
      "rues",
      "registro unico empresarial",
      "consultar empresa",
      "rejsal",
      "camara de comercio",
      "que hace camara",
      "tramites camara",
      "obligaciones camara",
    ],
    title: "RUES y alcance de la Cámara de Comercio",
    content:
      "RUES (Registro Único Empresarial y Social): plataforma nacional que unifica registros de todas las cámaras de comercio.\n" +
      "Permite hacer trámites ante cualquier cámara desde cualquier lugar del país.\n" +
      "Consulta gratuita para comerciantes con matrícula al día en rues.org.co (búsqueda por tipo de organización, municipio, actividad económica, ingresos).\n" +
      "Límite de alcance: la Cámara de Comercio gestiona registros mercantiles, NO obligaciones tributarias (IVA, renta, retenciones). Esos temas son exclusivamente de la DIAN.\n" +
      "Canales CC Cartagena: cccartagena.org.co | chat virtual | sedes Manga y Ronda Real | CISE en El Carmen de Bolívar, Turbaco, Calamar, María La Baja.\n" +
      "Horarios: lun-jue 8am-4:30pm, vie 8am-3:30pm, sáb 9am-12pm (solo virtual).",
  },
];

export function detectCcIntent(normalizedMessage: string): boolean {
  const CC_KEYWORDS = [
    "camara de comercio",
    "matricula mercantil",
    "renovar matricula",
    "renovacion matricula",
    "renovacion mercantil",
    "registro mercantil",
    "usuario sii",
    "crear usuario sii",
    "sii camara",
    "rues",
    "rejsal",
    "ley 1780",
    "empresa joven",
    "uso de suelos",
    "ciiu 5630",
    "ciiu 9609",
    "renovacion anual",
    "vencimiento matricula",
    "tramite camara",
  ];
  return CC_KEYWORDS.some((kw) => normalizedMessage.includes(kw));
}

export function selectCcSnippets(normalizedMessage: string): CfoKbSnippet[] {
  const selected: CfoKbSnippet[] = [];

  const includes = (kws: string[]) => kws.some((kw) => normalizedMessage.includes(kw));

  if (includes(["crear usuario", "usuario sii", "sii", "acceso virtual", "cuenta camara"])) {
    selected.push(KB_CC_SNIPPETS.find((s) => s.id === "cc-crear-usuario-sii")!);
  }
  if (includes(["renovar", "matricula", "registro mercantil", "renovacion", "camara de comercio", "vencimiento matricula"])) {
    selected.push(KB_CC_SNIPPETS.find((s) => s.id === "cc-renovacion-matricula")!);
  }
  if (includes(["ley 1780", "empresa joven", "uso de suelos", "ciiu", "requisitos", "documentos"])) {
    selected.push(KB_CC_SNIPPETS.find((s) => s.id === "cc-requisitos-especiales")!);
  }
  if (includes(["rues", "rejsal", "que hace camara", "tramites camara", "obligaciones camara", "consultar empresa"])) {
    selected.push(KB_CC_SNIPPETS.find((s) => s.id === "cc-rues-y-alcance")!);
  }

  // Fallback: if CC intent detected but no specific snippet matched, return the main renovation one
  if (selected.length === 0) {
    selected.push(KB_CC_SNIPPETS.find((s) => s.id === "cc-renovacion-matricula")!);
  }

  return selected.filter(Boolean).slice(0, 2);
}
