import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { getSupabaseEnv } from "@/lib/supabase/config";

function buildEmbedFrameAncestors() {
  const wixDefaultOrigins = ["https://*.wixsite.com", "https://*.wix.com"];
  const extraOrigins = (process.env.WIX_EMBED_ORIGIN ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  return ["'self'", ...wixDefaultOrigins, ...extraOrigins].join(" ");
}

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });
  const { supabaseUrl, supabaseAnonKey } = getSupabaseEnv();

  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => {
          response.cookies.set(name, value, options);
        });
      },
    },
  });

  await supabase.auth.getUser();

  if (request.nextUrl.pathname.startsWith("/embed/chat")) {
    response.headers.set(
      "Content-Security-Policy",
      `frame-ancestors ${buildEmbedFrameAncestors()};`,
    );
  } else {
    response.headers.set("X-Frame-Options", "SAMEORIGIN");
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
