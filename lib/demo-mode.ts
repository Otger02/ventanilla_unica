export function isDemoModeEnabled() {
  const rawValue = process.env.DEMO_MODE;
  if (!rawValue) {
    return false;
  }

  const normalizedValue = rawValue.trim().toLowerCase();
  return normalizedValue === "true" || normalizedValue === "1" || normalizedValue === "yes";
}
