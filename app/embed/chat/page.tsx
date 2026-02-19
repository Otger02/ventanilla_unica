import { EmbedChatClient } from "@/app/embed/chat/embed-chat-client";

type EmbedChatPageProps = {
  searchParams: Promise<{
    theme?: string;
    title?: string;
  }>;
};

export default async function EmbedChatPage({ searchParams }: EmbedChatPageProps) {
  const resolvedSearchParams = await searchParams;
  const theme = resolvedSearchParams.theme === "dark" ? "dark" : "light";
  const title = resolvedSearchParams.title?.trim() || undefined;

  return <EmbedChatClient theme={theme} title={title} />;
}
