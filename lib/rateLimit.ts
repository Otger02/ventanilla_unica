const requestLog = new Map<string, number[]>();

export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  resetInSeconds: number;
};

export function getClientIp(headers: Headers) {
  const xForwardedFor = headers.get("x-forwarded-for");
  if (xForwardedFor) {
    const firstIp = xForwardedFor.split(",")[0]?.trim();
    if (firstIp) {
      return firstIp;
    }
  }

  const xRealIp = headers.get("x-real-ip")?.trim();
  if (xRealIp) {
    return xRealIp;
  }

  return "unknown";
}

export function checkRateLimit(
  key: string,
  limit: number,
  windowMs: number,
): RateLimitResult {
  const now = Date.now();
  const windowStart = now - windowMs;

  const recentRequests = (requestLog.get(key) ?? []).filter(
    (timestamp) => timestamp > windowStart,
  );

  if (recentRequests.length >= limit) {
    const oldestInWindow = recentRequests[0] ?? now;
    const resetInMs = Math.max(windowMs - (now - oldestInWindow), 0);

    requestLog.set(key, recentRequests);

    return {
      allowed: false,
      remaining: 0,
      resetInSeconds: Math.ceil(resetInMs / 1000),
    };
  }

  recentRequests.push(now);
  requestLog.set(key, recentRequests);

  const remaining = Math.max(limit - recentRequests.length, 0);

  return {
    allowed: true,
    remaining,
    resetInSeconds: Math.ceil(windowMs / 1000),
  };
}
