import { redirect } from "next/navigation";

import { ChatClient } from "@/app/chat/chat-client";
import { isDemoModeEnabled } from "@/lib/demo-mode";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export default async function ChatPage() {
  const demoMode = isDemoModeEnabled();
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!demoMode && !user) {
    redirect("/login");
  }

  return <ChatClient demoMode={demoMode} />;
}
