import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";

dotenv.config({ path: ".env.local" });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
const SANDBOX_EMAIL = "sandbox-operadora-andina@example.com";

async function main() {
  console.log(`\nLooking for sandbox user: ${SANDBOX_EMAIL}`);

  const { data: userList, error: listErr } = await supabase.auth.admin.listUsers();
  if (listErr) {
    console.error("Error listing users:", listErr.message);
    process.exit(1);
  }

  const user = userList?.users.find((u) => u.email === SANDBOX_EMAIL);
  if (!user) {
    console.log("No sandbox user found. Nothing to reset.\n");
    process.exit(0);
  }

  const userId = user.id;
  console.log(`Found user: ${userId}`);

  // Delete in dependency order (tables with FKs first)
  const tables = [
    "invoice_activity_log",
    "invoice_receipts",
    "invoice_files",
    "invoices",
    "profiles",
  ] as const;

  for (const table of tables) {
    const { error, count } = await supabase
      .from(table)
      .delete({ count: "exact" })
      .eq("user_id", userId);
    if (error) {
      console.warn(`  Warning deleting ${table}: ${error.message}`);
    } else {
      console.log(`  Deleted ${count ?? 0} rows from ${table}`);
    }
  }

  // Delete auth user (CASCADE would also handle the above)
  const { error: deleteErr } = await supabase.auth.admin.deleteUser(userId);
  if (deleteErr) {
    console.error("Error deleting auth user:", deleteErr.message);
    process.exit(1);
  }

  console.log(`\n=== Sandbox Reset Complete ===`);
  console.log(`Deleted user ${userId} (${SANDBOX_EMAIL}) and all associated data.\n`);
}

main().catch((e) => { console.error("Fatal:", e); process.exit(1); });
