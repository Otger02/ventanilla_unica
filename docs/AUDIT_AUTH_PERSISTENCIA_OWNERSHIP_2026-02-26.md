# Auditoría Auth + Persistencia + Data Ownership

Fecha: 2026-02-26
Alcance: revisión de código y SQL del repo (Next.js + Supabase), sin cambios funcionales.

## 1) Cómo funciona el auth hoy (estado exacto)

### Flujo actual (resumen)

```mermaid
flowchart TD
  A[Usuario ingresa email en /login] --> B[supabase.auth.signInWithOtp]
  B --> C[Magic link a /auth/callback?code=...]
  C --> D[supabase.auth.exchangeCodeForSession]
  D --> E[Cookie de sesión Supabase en servidor/cliente]
  E --> F[/chat y APIs validan supabase.auth.getUser]
  F --> G[Persistencia por user.id]

  H[DEMO_MODE=true] --> I[/chat permite acceso sin sesión]
  I --> J[/api/chat permite usuario anónimo]
  J --> K[conversations/messages con user_id = null]
```

### Evidencia de implementación

- Login con OTP (magic link): `app/login/login-form.tsx`.
- Callback de sesión: `app/auth/callback/route.ts`.
- Cliente SSR con cookies: `lib/supabase/server.ts` + `proxy.ts` (refresh/propagación de cookies).
- Protección de `/chat` cuando `DEMO_MODE=false`: `app/chat/page.tsx`.
- En `DEMO_MODE=true`, `/api/chat` permite anónimo y guarda `user_id = null`: `app/api/chat/route.ts`.

### Identidad usada en DB

- Identificador principal: `auth.users.id` (`user.id`) como `user_id` en tablas.
- No hay `org_id` en las entidades actuales.
- Email se usa para autenticación (OTP), no como key de ownership de datos.

---

## 2) Qué datos persisten hoy y dónde

## 2.1 Tablas en Supabase

### Definidas en `supabase/schema.sql`

1. `public.conversations`
   - Guarda hilos de chat.
   - Campos clave: `id`, `user_id`, `created_at`.

2. `public.messages`
   - Guarda mensajes de chat.
   - Campos clave: `id`, `conversation_id`, `role`, `content`, `user_id`, `created_at`.

3. `public.documents`
   - Metadata de PDFs.
   - Campos clave: `id`, `user_id`, `title`, `category`, `storage_path`, `created_at`.

### Usadas por API pero no definidas en `supabase/schema.sql` actual

4. `public.user_tax_profile_co`
   - Perfil fiscal del usuario.
   - Campos observados en código: `user_id`, `persona_type`, `activity_type`, `regimen`, `vat_responsible`, `provision_style`, `taxpayer_type`, `legal_type`, `vat_periodicity`, `monthly_fixed_costs_cop`, `monthly_payroll_cop`, `monthly_debt_payments_cop`, `municipality`, `start_date`, `created_at`, `updated_at`.

5. `public.monthly_tax_inputs_co`
   - Datos fiscales mensuales para cálculos.
   - Campos observados: `id`, `user_id`, `year`, `month`, `income_cop`, `deductible_expenses_cop`, `withholdings_cop`, `vat_collected_cop`, `notes`, `created_at`.

Nota: existe migración `supabase/migrations/20260220_add_provision_style_to_user_tax_profile_co.sql`, lo que confirma drift entre `schema.sql` y el modelo real en uso.

## 2.2 Storage buckets

- Bucket `docs` (privado, `public=false`) creado en `supabase/schema.sql`.
- Subidas en `app/api/documents/route.ts` con path `user.id/timestamp-filename.pdf`.
- Metadata relacionada en tabla `documents`.

## 2.3 Persistencia en cliente (browser)

- No se encontraron usos explícitos de `localStorage`, `sessionStorage` ni `IndexedDB` en el código de app.
- Sí se usa cliente Supabase en browser (`lib/supabase/browser.ts`) para auth; la librería de Supabase maneja la sesión del cliente internamente (normalmente storage web).
- Estado de chat (`conversationId`, mensajes) se mantiene en memoria React en sesión actual; no hay guardado explícito local por código.

---

## 3) Seguridad mínima (RLS + aislamiento)

## 3.1 RLS y políticas

En el SQL versionado del repo (`supabase/schema.sql` + migraciones visibles):

- No aparecen sentencias `ALTER TABLE ... ENABLE ROW LEVEL SECURITY`.
- No aparecen `CREATE POLICY` para tablas de negocio.

Conclusión de auditoría de repo: no hay evidencia versionada de RLS/policies activas.

## 3.2 Aislamiento por código de aplicación

Sí hay filtros por usuario en handlers:

- `documents`: `.eq("user_id", user.id)`
- `user_tax_profile_co`: `.eq("user_id", user.id)`
- `monthly_tax_inputs_co`: `.eq("user_id", user.id)`
- `conversations/messages`: lookup por conversación + validación de `user_id` (o `null` en demo)

Esto reduce riesgo en rutas existentes, pero no reemplaza RLS a nivel DB.

## 3.3 Riesgos detectados

1. **Alto** — Falta de RLS/policies versionadas
   - Si una clave cliente o endpoint futuro expone acceso directo PostgREST, podría haber lectura/escritura cruzada entre usuarios.

2. **Medio-Alto** — `DEMO_MODE` persiste chat anónimo con `user_id = null`
   - En demo, ownership queda difuso (`null`) y el aislamiento depende solo de la capa API.
   - Riesgo adicional de mezcla de datos anónimos si se reusa `conversationId`.

3. **Medio** — Deriva de esquema (schema drift)
   - Tablas fiscales activas no están definidas en `supabase/schema.sql` actual.
   - Aumenta probabilidad de inconsistencias entre entornos.

4. **Bajo-Medio** — `/admin/docs` sin control de rol explícito
   - Requiere login, pero no hay check de rol admin; funcionalmente es “admin para cualquier autenticado”.

---

## 4) Modelo estándar de ownership recomendado (target)

## 4.1 Claves obligatorias por entidad

Para cada entidad de negocio (incluyendo facturas futuras):

- `org_id uuid not null` (FK a `organizations.id`)
- `user_id uuid not null` (FK a `auth.users.id`, actor dueño o creador)
- `created_by_user_id uuid not null` (si aplica auditoría explícita)
- `created_at`, `updated_at`

## 4.2 Convenciones de nombres y FK

- Tablas: `snake_case` plural (`invoices`, `invoice_lines`, `documents`, etc.).
- FK explícitas:
  - `... references public.organizations(id)`
  - `... references auth.users(id)`
- Índices mínimos:
  - `idx_<table>_org_id`
  - `idx_<table>_user_id`
  - índices compuestos por acceso frecuente (`org_id, created_at desc`).
- Unicidad por organización cuando aplique:
  - ejemplo: `unique (org_id, external_source, external_id)`.

## 4.3 Patrón de RLS recomendado

- Activar RLS en todas las tablas de negocio.
- Política base de lectura/escritura:
  - `org_id` debe pertenecer a una membresía activa del usuario autenticado.
- Política opcional por creador:
  - Para tablas personales: además `user_id = auth.uid()`.

## 4.4 Patrón para Route Handlers (Next)

1. Resolver sesión (`supabase.auth.getUser()`); rechazar si no autenticado.
2. Resolver organización activa (por header/cookie/subdominio o tabla de membresía).
3. Toda query debe filtrar por `org_id` (y por `user_id` cuando aplique).
4. Inserts deben setear explícitamente `org_id` + `user_id` del contexto autenticado.
5. Nunca aceptar `org_id` del cliente sin validación contra membresías.

---

## 5) Plan mínimo de cambios (antes del módulo de facturas)

Sin implementar importador aún.

1. **Blindaje DB (prioridad 1)**
   - Añadir migraciones para:
     - `ENABLE RLS` en `conversations`, `messages`, `documents`, `user_tax_profile_co`, `monthly_tax_inputs_co`.
     - Policies owner-based inmediatas (`user_id = auth.uid()`) donde aún no exista `org_id`.

2. **Eliminar ownership ambiguo en demo (prioridad 1)**
   - Opción mínima segura: en `DEMO_MODE`, no persistir chat en DB (solo respuesta en memoria request) **o** persistir en namespace demo separado no sensible.

3. **Normalizar esquema (prioridad 2)**
   - Actualizar `supabase/schema.sql` para reflejar todas las tablas realmente usadas hoy.
   - Evitar drift entre bootstrap y producción.

4. **Preparar ownership multi-tenant (prioridad 2)**
   - Crear `organizations` y `organization_memberships`.
   - Agregar `org_id` nullable al inicio + backfill + luego `not null`.

5. **Control de acceso de admin/docs (prioridad 3)**
   - Añadir check de rol/permiso explícito para `/admin/docs`.

---

## 6) Mitigación aplicada (PR mínimo)

Se aplicaron cambios mínimos de seguridad y consistencia, sin refactor de UX:

1. **RLS + policies owner-based**
   - Nueva migración: `supabase/migrations/20260226_rls_owner_policies_and_tax_baseline.sql`.
   - Se habilita RLS en:
     - `public.conversations`
     - `public.messages`
     - `public.documents`
     - `public.user_tax_profile_co`
     - `public.monthly_tax_inputs_co`
   - Se crean policies de `SELECT/INSERT/UPDATE/DELETE` por owner con regla base `user_id = auth.uid()`.
   - En `messages`, las policies validan además que `conversation_id` pertenezca al mismo usuario mediante `EXISTS` sobre `conversations`.

2. **Fix DEMO_MODE (sin ownership ambiguo)**
   - Archivo: `app/api/chat/route.ts`.
   - En `DEMO_MODE`, el chat **ya no inserta** en `conversations/messages`.
   - Se mantiene respuesta del asistente (compute + response), con `conversationId` efímero en memoria de request.
   - En modo normal (no demo), la persistencia permanece igual y ahora queda reforzada por RLS/policies.

3. **Reducción de schema drift**
   - En la misma migración se añadió baseline segura para tablas fiscales si faltan:
     - `public.user_tax_profile_co`
     - `public.monthly_tax_inputs_co`
   - Se usan `create table if not exists` y `add column if not exists` para minimizar riesgo en entornos ya existentes.
   - Se agregan índices mínimos por owner/tiempo (`user_id, created_at desc`) donde aplica.

Estado: mitigación crítica aplicada sin introducir módulo de facturas.

---

## Veredicto ejecutivo

- Auth actual: Supabase Auth con sesión por cookies + magic link; existe bypass anónimo en `DEMO_MODE` para chat.
- Persistencia actual: DB (5 tablas operativas observadas), bucket privado `docs`, sin persistencia local explícita en app.
- Riesgo principal antes de facturas: falta de RLS/policies versionadas + ownership sin `org_id`.
- Recomendación: cerrar RLS y ownership base primero; luego avanzar al módulo de facturas sobre ese estándar.
