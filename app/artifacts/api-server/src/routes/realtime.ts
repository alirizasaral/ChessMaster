import { Router } from "express";
import { detectOpenAiQuotaError } from "../lib/openai-quota-error.js";

const router = Router();

// OpenAI Realtime API (GA) — model + voice.
// `gpt-realtime-2` is the reasoning realtime model; "marin" is a warm, expressive voice.
const REALTIME_MODEL = "gpt-realtime-2";
const REALTIME_VOICE = "marin";

/**
 * Mint a short-lived ephemeral client secret for the browser to use when
 * establishing a WebRTC connection directly to OpenAI's Realtime GA API.
 *
 * Docs: https://platform.openai.com/docs/guides/realtime
 *
 * The ephemeral token (returned as `value`) is safe to send to the browser —
 * it's scoped to a single Realtime session and expires in ~1 minute.
 */
router.post("/realtime/session", async (_req, res) => {
  if (!process.env.OPENAI_API_KEY) {
    res.status(500).json({ error: "OPENAI_API_KEY is not configured" });
    return;
  }

  try {
    const response = await fetch("https://api.openai.com/v1/realtime/client_secrets", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        session: {
          type: "realtime",
          model: REALTIME_MODEL,
          reasoning: { effort: "minimal" },
          audio: {
            output: { voice: REALTIME_VOICE },
          },
        },
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error(
        `OpenAI Realtime client_secrets error status=${response.status} body=${errText}`,
      );
      const payload: { error: string; code?: string } = {
        error: `OpenAI Realtime error: ${errText}`,
      };
      if (detectOpenAiQuotaError(response.status, errText)) {
        payload.code = "insufficient_funds";
      }
      res.status(response.status).json(payload);
      return;
    }

    const data = (await response.json()) as Record<string, unknown>;
    // Pass through the OpenAI response, plus the model so the client knows
    // which model to use when POSTing its SDP offer.
    res.json({ ...data, model: REALTIME_MODEL });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    res.status(500).json({ error: `Realtime session error: ${message}` });
  }
});

export default router;
