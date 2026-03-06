import "server-only";

export function getGeminiConfig() {
  const rawApiKey =
    process.env.GEMINI_API_KEY ??
    process.env.GOOGLE_API_KEY ??
    process.env.NEXT_PUBLIC_GEMINI_API_KEY ??
    "";

  const apiKey = rawApiKey.trim().replace(/^['\"]|['\"]$/g, "");
  const model =
    process.env.GEMINI_MODEL?.trim() ||
    process.env.GOOGLE_MODEL?.trim() ||
    "gemini-3-flash-preview";

  return {
    apiKey,
    model,
    hasApiKey: apiKey.length > 0,
  };
}
