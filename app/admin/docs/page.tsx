import { notFound, redirect } from "next/navigation";

import { DocsManager } from "@/app/admin/docs/docs-manager";
import { isDemoModeEnabled } from "@/lib/demo-mode";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export default async function AdminDocsPage() {
  if (isDemoModeEnabled()) {
    notFound();
  }

  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  return <DocsManager />;
}
