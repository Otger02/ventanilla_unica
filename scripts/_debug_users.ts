import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";
dotenv.config({ path: ".env.local" });
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) { console.error("Missing env"); process.exit(1); }
const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
async function main() {
  const { data, error } = await sb.auth.admin.listUsers({ page: 1, perPage: 100 });
  if (error) { console.log("Error:", error.message); } else { console.log("Total:", data.users.length); data.users.forEach((u) => console.log(u.email, u.id)); }
  process.exit(0);
}
main();
