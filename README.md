# ventanilla-unica

Aplicacion de chat propia en Next.js (App Router) + TypeScript + Supabase.

## Requisitos

- Node.js 18+
- Proyecto de Supabase

## Configuracion

1. Instala dependencias:

```bash
npm i
```

2. Crea/edita variables de entorno en `.env.local`:

```env
SUPABASE_URL=tu_supabase_url
SUPABASE_ANON_KEY=tu_supabase_anon_key
NEXT_PUBLIC_SUPABASE_URL=tu_supabase_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=tu_supabase_anon_key
OPENAI_API_KEY=tu_openai_api_key
OPENAI_MODEL=gpt-5
DEMO_MODE=false
DEBUG_TAX=false
WIX_EMBED_ORIGIN=
```

Modelos de ejemplo:
- OPENAI_MODEL=gpt-5
- OPENAI_MODEL=gpt-4.1-mini (ejemplo barato)

4. En Supabase Authentication > URL Configuration, agrega tu URL de callback:
  - Desarrollo: `http://localhost:3000/auth/callback`

3. Crea las tablas en Supabase:
   - Abre Supabase Dashboard > SQL Editor.
   - Ejecuta el contenido de `supabase/schema.sql`.

4. Bucket de documentos (`docs`):
  - El SQL de `supabase/schema.sql` incluye la creacion del bucket `docs`.
  - Alternativa manual: Supabase Dashboard > Storage > Create bucket > nombre `docs`.

## Ejecutar en desarrollo

```bash
npm run dev
```

Abre `http://localhost:3000/chat`.

## Autenticacion (Magic Link)

- Ruta de acceso: `/login`.
- Ingresas tu email y haces clic en `Enviar enlace`.
- El enlace magico redirige a `/auth/callback` y luego a `/chat`.
- `/chat` esta protegido: sin sesion activa redirige a `/login`.
- Dentro de `/chat` hay boton `Cerrar sesion`.

## Modo Demo

- Activa `DEMO_MODE=true` para permitir acceso a `/chat` sin login.
- En demo, el chat sigue funcionando y guarda `user_id` como `null`.
- En demo se muestra una banda superior `DEMO MODE`.
- Con `DEMO_MODE=false`, el comportamiento normal exige login.
- Flujo recomendado para demo en Wix: `Wix -> boton -> abrir https://app.tudominio.com/chat`.
- Valores aceptados para activar DEMO_MODE: `true`, `1`, `yes`.

## Modo producción

- En producción, `DEMO_MODE` debe estar desactivado (`false`).
- Con `DEMO_MODE=false`, `/chat` exige sesión activa y redirige a `/login` si no hay sesión.
- `DEMO_MODE=true` se considera solo para desarrollo local (`NODE_ENV=development`).

### Verificar DEMO_MODE en desarrollo

1. En `.env.local`, define `DEMO_MODE=true` (o `1` / `yes`).
2. Ejecuta la app en local (`npm run dev`).
3. Prueba `http://localhost:3000/chat`:
  - Si DEMO_MODE está activo, no debe redirigir a `/login`.
  - Si DEMO_MODE está inactivo, mantiene auth normal y redirige a `/login` sin sesión.
4. En desarrollo (`NODE_ENV=development`) `/chat` muestra un bloque `DEMO DEBUG` con:
  - `process.env.DEMO_MODE` leído en servidor
  - resultado de `demoMode()`

## Documentos (Storage)

- Ruta: `/admin/docs`.
- Solo accesible para usuarios logueados.
- Si `DEMO_MODE=true`, la ruta se oculta.
- Permite subir PDF y guardar metadata en tabla `documents`:
  - `title`
  - `category` (`tax`, `deductions`, `hiring`, `finance`)
  - `storage_path`
- No incluye embeddings (solo subida y listado).

## Chat embebido (iframe)

- Ruta publica de embed: `/embed/chat`.
- Estado actual: no recomendado para uso publico.
- Query params opcionales:
  - `theme=light|dark`
  - `title=Texto%20del%20chat`

Ejemplo:

`/embed/chat?theme=dark&title=Asistente%20Fiscal`

### Embebido en Wix

Disponible para pruebas internas. Para demos productivas usa apertura a `/chat`.

En Wix, un iframe puede apuntar a tu app:

```html
<iframe
  src="https://TU_DOMINIO/embed/chat?theme=light&title=Ventanilla%20Unica"
  width="100%"
  height="700"
  style="border:0;"
  allow="clipboard-write"
></iframe>
```

### Seguridad de iframe

- Solo `/embed/chat` permite framing externo.
- Se aplica `Content-Security-Policy` con `frame-ancestors` para dominios Wix (`*.wixsite.com`, `*.wix.com`).
- Puedes agregar dominios permitidos extra con `WIX_EMBED_ORIGIN` (separados por coma).
- El resto de rutas mantiene `X-Frame-Options: SAMEORIGIN`.
- El embed se reforzara en el futuro con rate limiting y captcha.

## API

### `POST /api/chat`

Body JSON:

```json
{
  "conversationId": "opcional",
  "message": "hola"
}
```

Respuesta:

```json
{
  "conversationId": "uuid",
  "reply": "respuesta generada por OpenAI"
}
```

Notas:
- El endpoint usa OpenAI con un system prompt fijo para Ventanilla Única.
- El modelo se configura con OPENAI_MODEL (si no existe, usa gpt-5).
- Longitud maxima de mensaje: 2000 caracteres (`MAX_MESSAGE_LENGTH`).
- Si se supera, responde `400` con `{ "error": "Message too long" }`.
- Antes de generar respuesta, incluye los últimos 10 mensajes de la conversación como contexto.
- Si `DEMO_MODE=false`, el endpoint requiere sesion activa y guarda `user_id` del usuario.
- Si `DEMO_MODE=true`, permite uso sin sesion y guarda `user_id` en `null`.

## Rate limiting (MVP)

- `POST /api/chat` tiene rate limit basico por IP.
- Limite actual: `20` requests por minuto por IP.
- Si se supera, responde `429` con JSON: `{ "error": "Rate limit exceeded" }`.
- Implementacion actual en memoria (`Map` en Node), valida para MVP.
- En produccion se migrara a Redis para manejo distribuido y persistente.

## Flujo de persistencia

- Si `conversationId` no llega o no existe, se crea una fila en `conversations`.
- Se guarda el mensaje del usuario en `messages` con `role = 'user'`.
- Se genera una respuesta del asistente y se guarda en `messages` con `role = 'assistant'`.

## Nota

Esta app no usa Wix. Es la app de chat propia para enlazarla despues desde Wix.
