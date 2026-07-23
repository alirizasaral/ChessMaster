import { coachEventToRequestBody, type CoachEvent } from "@/lib/coach-prompts";

/**
 * Request coaching text from POST /api/coach when voice is disconnected.
 */
export async function requestCoachFeedback(
  event: CoachEvent,
  userName?: string,
): Promise<string> {
  const BASE_URL = import.meta.env.BASE_URL;
  const body = coachEventToRequestBody(event, userName);
  const resp = await fetch(`${BASE_URL}api/coach`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const text = await resp.text();
    let message = `Coach request failed (${resp.status})`;
    try {
      const parsed = JSON.parse(text) as { error?: string };
      if (parsed.error) message = parsed.error;
    } catch {
      if (text) message = text;
    }
    throw new Error(message);
  }
  const data = (await resp.json()) as { feedback?: string };
  return data.feedback?.trim() || "No feedback available.";
}
