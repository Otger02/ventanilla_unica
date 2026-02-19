import { createClient } from "@supabase/supabase-js";

export function getSupabaseClient() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error(
      "Faltan SUPABASE_URL o SUPABASE_ANON_KEY en las variables de entorno.",
    );
  }

  return createClient(supabaseUrl, supabaseAnonKey);
}
