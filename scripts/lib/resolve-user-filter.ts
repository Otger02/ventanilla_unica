import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Parse --user-email <email> or --user-id <uuid> from process.argv.
 * Returns the resolved user_id or null if no filter was specified.
 */
export async function resolveUserFilter(
  supabase: SupabaseClient,
  argv: string[],
): Promise<string | null> {
  const emailIdx = argv.indexOf("--user-email");
  const idIdx = argv.indexOf("--user-id");

  if (emailIdx !== -1) {
    const email = argv[emailIdx + 1];
    if (!email) {
      console.error("Missing value for --user-email");
      process.exit(1);
    }
    // Paginate through all users to find by email
    let page = 1;
    const perPage = 100;
    while (true) {
      const { data, error } = await supabase.auth.admin.listUsers({ page, perPage });
      if (error) {
        console.error("Error listing users:", error.message);
        process.exit(1);
      }
      const user = data?.users.find((u) => u.email === email);
      if (user) {
        console.log(`Filter: user ${email} (${user.id})\n`);
        return user.id;
      }
      if (!data?.users.length || data.users.length < perPage) break;
      page++;
    }
    console.error(`User not found: ${email}`);
    process.exit(1);
  }

  if (idIdx !== -1) {
    const id = argv[idIdx + 1];
    if (!id) {
      console.error("Missing value for --user-id");
      process.exit(1);
    }
    console.log(`Filter: user_id ${id}\n`);
    return id;
  }

  return null;
}
