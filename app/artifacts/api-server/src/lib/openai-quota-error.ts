const QUOTA_BODY_MARKERS = [
  "insufficient_quota",
  "insufficient_funds",
  "exceeded your current quota",
  "billing hard limit",
  "insufficient funds",
  "check your plan and billing",
  "monthly budget",
  "maximum monthly spend",
] as const;

function collectErrorText(body: string): string {
  const parts = [body];
  try {
    const parsed = JSON.parse(body) as Record<string, unknown>;
    const error = parsed.error;
    if (typeof error === "string") {
      parts.push(error);
    } else if (error && typeof error === "object") {
      const errObj = error as Record<string, unknown>;
      for (const key of ["type", "code", "message"]) {
        const value = errObj[key];
        if (typeof value === "string") parts.push(value);
      }
    }
    for (const key of ["code", "message", "type"]) {
      const value = parsed[key];
      if (typeof value === "string") parts.push(value);
    }
  } catch {
    /* plain text body */
  }
  return parts.join(" ").toLowerCase();
}

export function detectOpenAiQuotaError(status: number | undefined, body: string): boolean {
  if (status === 402) return true;

  const text = collectErrorText(body);
  if (QUOTA_BODY_MARKERS.some((marker) => text.includes(marker))) return true;

  if (
    status === 429 &&
    (text.includes("quota") || text.includes("billing") || text.includes("spend"))
  ) {
    return true;
  }

  return false;
}
