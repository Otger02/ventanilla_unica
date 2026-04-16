export type OperationalNote = {
  id: string;
  owner_user_id: string;
  author_label: string;
  target_type: "invoice" | "review_queue" | "weekly_plan" | "goal" | "dashboard";
  target_id: string | null;
  content: string;
  created_at: string;
  updated_at: string;
};
