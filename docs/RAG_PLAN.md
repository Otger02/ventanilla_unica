# Plan de RAG (pendiente de implementación)

Este documento describe el plan para añadir recuperación aumentada (RAG) sobre documentos en fases futuras.

## 1) Tabla `doc_chunks` con `embedding vector`

Objetivo: almacenar fragmentos de documentos y sus embeddings para búsqueda semántica.

Diseño propuesto (conceptual):
- `id`: identificador único del chunk.
- `document_id`: referencia al documento origen (`documents.id`).
- `chunk_index`: orden del fragmento dentro del documento.
- `content`: texto del fragmento.
- `embedding`: vector numérico para similitud semántica.
- `tokens_count` (opcional): tamaño estimado del chunk.
- `created_at`: fecha de creación.

Consideraciones:
- Habilitar extensión vectorial en Postgres (pgvector) cuando se implemente.
- Índice por similitud para consultas rápidas.
- Restricciones por `document_id` + `chunk_index` para evitar duplicados.

## 2) Proceso de chunking

Objetivo: convertir cada PDF en fragmentos útiles para recuperación.

Flujo propuesto:
1. Extraer texto del PDF.
2. Limpiar texto (saltos, espacios, caracteres no útiles).
3. Dividir en chunks por tamaño objetivo (por ejemplo, por tokens), con solapamiento.
4. Guardar metadatos del chunk (documento, índice, categoría, etc.).

Buenas prácticas:
- Tamaño de chunk equilibrado (ni muy corto ni muy largo).
- Solapamiento moderado para mantener contexto entre fragmentos.
- Excluir páginas vacías o ruido (headers/footers repetitivos) cuando sea posible.

## 3) Generación de embeddings

Objetivo: generar un vector por cada chunk y persistirlo.

Flujo propuesto:
1. Seleccionar modelo de embeddings de OpenAI.
2. Procesar chunks en lotes para eficiencia.
3. Reintentar en errores transitorios.
4. Guardar embedding junto al chunk.

Buenas prácticas:
- Versionar el modelo usado en metadatos (para migraciones futuras).
- Evitar regenerar embeddings si el chunk no cambió.
- Definir estrategia de reindexación cuando cambie el modelo.

## 4) Query por similitud

Objetivo: recuperar los chunks más relevantes para una pregunta del usuario.

Flujo propuesto:
1. Generar embedding de la consulta del usuario.
2. Buscar top-k chunks por cercanía vectorial.
3. Filtrar por umbral de similitud mínimo.
4. Opcional: aplicar filtros por `category`, fecha o documento.

Salida esperada:
- Lista ordenada de chunks relevantes.
- Metadatos para trazabilidad (documento, título, categoría, posición).

## 5) Inyección de fuentes al prompt

Objetivo: mejorar respuestas del asistente usando evidencia recuperada.

Estrategia propuesta:
1. Construir un bloque de contexto con los chunks recuperados.
2. Incluir fuente por cada fragmento (título de documento + referencia interna).
3. Inyectar el bloque antes de la pregunta final del usuario.
4. Pedir explícitamente al modelo:
   - usar solo contexto proporcionado para afirmaciones específicas,
   - indicar incertidumbre cuando falten datos,
   - no inventar cifras o fechas oficiales.

Formato sugerido del contexto (conceptual):
- Fuente 1: [Documento X, chunk N]
- Fuente 2: [Documento Y, chunk M]
- ...

## 6) Fases sugeridas

- Fase A: estructura de datos (`doc_chunks`) y extracción/chunking.
- Fase B: embeddings y almacenamiento vectorial.
- Fase C: endpoint de recuperación semántica.
- Fase D: integración al flujo de `/api/chat` con citación de fuentes.
- Fase E: evaluación de calidad (precisión, cobertura, latencia).

## 7) Fuera de alcance por ahora

- Implementación de SQL definitiva.
- Procesamiento automático en background.
- Ranking híbrido (keyword + vector).
- UI avanzada de administración de chunks.

Este plan es solo de diseño. No incluye implementación en código todavía.
