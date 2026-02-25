# Pruebas de mesa — Chat CFO/Fiscal

Objetivo: validar comportamiento del chat en escenarios estratégicos de IVA/caja, con foco en reglas de conversación, cálculo por horizonte, uso de snippets y control de preguntas.

## Caso 1 — IVA vence en 3 días (liquidez parcial + recursos movibles)
- **Input usuario:**
  - "Me vence el IVA en 3 días. Hoy puedo apartar 300.000. Tengo 200.000 en cobros probables y puedo diferir 150.000 de proveedor."
- **Expected behavior:**
  - Identifica enfoque IVA (sin mezclar renta/provisión total).
  - Calcula obligación IVA y faltante bruto.
  - Integra recursos movibles (cobros probables + pagos diferibles) antes de dividir.
  - Si presión real > 0, divide por 3 días y muestra COP/día.
  - Entrega plan operativo por Día 1..Día 3 (sin Día 4).
  - Máximo 1 pregunta final (solo si falta un dato bloqueante).
- **Snippets esperados (ids):**
  - `iva-separacion`
  - `priorizacion-vencimientos`
- **Modo esperado:**
  - `ANALISIS_INICIAL`

## Caso 2 — IVA vence en 5 semanas (aporte semanal)
- **Input usuario:**
  - "El IVA vence en 5 semanas y hoy aparto 300.000. ¿Cuánto debo apartar por semana?"
- **Expected behavior:**
  - Enfoque solo IVA.
  - Calcula faltante y luego aporte por semana (no por día).
  - Usa calendario Semana 1..Semana 5 (sin Semana 6).
  - No menciona renta si no fue solicitada.
- **Snippets esperados (ids):**
  - `iva-separacion`
  - `flujo-subcuentas`
- **Modo esperado:**
  - `ANALISIS_INICIAL`

## Caso 3 — No pagarlo de golpe + domiciliar
- **Input usuario:**
  - "No quiero pagarlo de golpe. ¿Puedo domiciliar esto y programar transferencias?"
- **Expected behavior:**
  - Propone opciones legales de cuotas/acuerdo y programación de pagos.
  - Explica cómo domiciliar/programar sin elevar complejidad.
  - Pide como máximo 1 dato bloqueante al final (canal o fecha objetivo).
- **Snippets esperados (ids):**
  - `cuotas-legales-dian`
  - `domiciliar-pagos`
- **Modo esperado:**
  - `ANALISIS_INICIAL`

## Caso 4 — Justo de caja: priorizar nómina o IVA (fechas distintas)
- **Input usuario:**
  - "Estoy justo de caja, ¿priorizo nómina o IVA? Nómina vence en 2 días e IVA en 12 días."
- **Expected behavior:**
  - Prioriza por vencimiento + riesgo operativo/legal.
  - No sugiere pago parcial del IVA al Estado.
  - Si caja no alcanza, recomienda plan de aportes a subcuenta hasta vencimiento IVA.
  - Da plan corto con secuencia operativa clara.
- **Snippets esperados (ids):**
  - `priorizacion-vencimientos`
  - `flujo-subcuentas`
- **Modo esperado:**
  - `ANALISIS_INICIAL`

## Caso 5 — Sin monthly_inputs, usando fallback
- **Input usuario:**
  - "¿Cuánto aparto de IVA esta semana?"
- **Expected behavior:**
  - Informa explícitamente que no hay datos del periodo actual y que usa fallback.
  - Pide confirmación de uso del mes fallback antes de avanzar en recomendaciones finas.
  - No inventa cifras fuera de FINANCIAL_CONTEXT/CALCULO_ACTUAL.
- **Snippets esperados (ids):**
  - `iva-separacion`
- **Modo esperado:**
  - `ANALISIS_INICIAL`

## Caso 6 — Horizonte explícito sin liquidez actual
- **Input usuario:**
  - "Me vence en 3 días, ¿cómo lo cubro?"
- **Expected behavior:**
  - No calcula aporte por día todavía.
  - Cierra con 1 sola pregunta bloqueante: "¿Cuánto puedes apartar hoy para IVA?"
  - Mantiene enfoque IVA sin mezclar renta.
- **Snippets esperados (ids):**
  - `iva-separacion`
  - `priorizacion-vencimientos`
- **Modo esperado:**
  - `ANALISIS_INICIAL`

## Caso 7 — Usuario pide explícitamente provisión total
- **Input usuario:**
  - "Además del IVA, dime la provisión total incluyendo renta."
- **Expected behavior:**
  - Habilita cálculo de renta/provisión total porque el usuario lo pidió explícitamente.
  - Muestra cálculo mínimo necesario, sin volver a resumen largo si es continuidad.
  - Si faltan datos críticos, pide máximo 1 pregunta bloqueante.
- **Snippets esperados (ids):**
  - `iva-separacion`
  - `priorizacion-vencimientos`
- **Modo esperado:**
  - `SEGUIMIENTO`

## Caso 8 — Seguimiento con nuevo dato (sin re-resumen completo)
- **Input usuario:**
  - "Con los nuevos datos: ahora puedo apartar 500.000 hoy."
- **Expected behavior:**
  - Empieza con "Con los nuevos datos…".
  - Recalcula solo lo mínimo afectado (faltante/aporte), sin repetir todo el diagnóstico.
  - Mantiene misma unidad temporal del horizonte previo (si sigue vigente).
- **Snippets esperados (ids):**
  - `flujo-subcuentas`
- **Modo esperado:**
  - `SEGUIMIENTO`

## Caso 9 — Solicitud explícita de re-resumen total
- **Input usuario:**
  - "Resúmeme todo desde cero con números y plan final."
- **Expected behavior:**
  - Re-resumen completo permitido por petición explícita.
  - Mantiene estructura: lo que sé, cálculo, plan operativo, pregunta final (máx 1) solo si bloquea.
  - No inventa datos faltantes.
- **Snippets esperados (ids):**
  - `priorizacion-vencimientos`
  - `iva-separacion`
- **Modo esperado:**
  - `ANALISIS_INICIAL`

## Caso 10 — Pregunta no fiscal/financiera (control de costo KB)
- **Input usuario:**
  - "¿Cuál es la dirección de la DIAN en mi ciudad?"
- **Expected behavior:**
  - No forzar cálculo fiscal ni estrategia de caja.
  - No inyectar snippets CFO si no aporta al caso.
  - Respuesta breve y directa; pregunta final solo si es necesaria.
- **Snippets esperados (ids):**
  - Ninguno
- **Modo esperado:**
  - `ANALISIS_INICIAL`
