import "server-only";
import { createServiceRoleClient } from "@/lib/supabase/service";

export type SharedView = {
  id: string;
  owner_user_id: string;
  shared_with_email: string;
  access_mode: "read_only" | "advisor_limited";
  token: string;
  is_active: boolean;
  created_at: string;
  expires_at: string | null;
};

type ValidationSuccess = { valid: true; sharedView: SharedView };
type ValidationFailure = { valid: false; reason: "not_found" | "inactive" | "expired" };

export async function validateSharedToken(
  token: string,
): Promise<ValidationSuccess | ValidationFailure> {
  const supabase = createServiceRoleClient();

  const { data, error } = await supabase
    .from("shared_views")
    .select("id, owner_user_id, shared_with_email, access_mode, token, is_active, created_at, expires_at")
    .eq("token", token)
    .maybeSingle();

  if (error || !data) {
    return { valid: false, reason: "not_found" };
  }

  if (!data.is_active) {
    return { valid: false, reason: "inactive" };
  }

  if (data.expires_at && new Date(data.expires_at) < new Date()) {
    return { valid: false, reason: "expired" };
  }

  return { valid: true, sharedView: data as SharedView };
}
