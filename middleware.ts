// Si usas proxy.ts o agregas middleware.ts en tu raíz de Next.js
import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { getSupabaseEnv } from "@/lib/supabase/config" // Ya la veo en tu codebase

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request })
  const { supabaseUrl, supabaseAnonKey } = getSupabaseEnv()

  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll()
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value, options }) => request.cookies.set(name, value))
        // Volvemos a clonar la respuesta para asegurar que Next propague las cookies hacia abajo
        response = NextResponse.next({ request })
        cookiesToSet.forEach(({ name, value, options }) => {
          response.cookies.set(name, value, options)
        })
      },
    }
  })

  // EL CÓDIGO CLAVE PARA EL BACKEND SAAS 🛡️:
  // Al invocar esta línea, la sesión ligada al Magic Link se intercepta, verifica y, de 
  // ser necesario, se refresca transparentemente adjuntado el Context-Sub válido 
  // para que Supabase reconozca correctamente el auth.uid() en los RLS de la Base de Datos.
  await supabase.auth.getUser()

  return response
}

// Asegurarse de interceptar llamadas de api y vistas (excluir estáticos)
export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}