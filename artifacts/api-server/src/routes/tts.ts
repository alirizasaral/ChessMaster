import { Router } from "express";
import { TextToSpeechBody } from "@workspace/api-zod";

const router = Router();

const ELEVENLABS_VOICE_ID = "EXAVITQu4vr4xnSDxMaL"; // "Bella" - friendly female voice
const ELEVENLABS_MODEL_ID = "eleven_turbo_v2";

router.post("/tts", async (req, res) => {
  const parseResult = TextToSpeechBody.safeParse(req.body);
  if (!parseResult.success) {
    res.status(400).json({ error: "Invalid request body" });
    return;
  }

  const { text } = parseResult.data;

  if (!process.env.ELEVENLABS_API_KEY) {
    res.status(500).json({ error: "ELEVENLABS_API_KEY is not configured" });
    return;
  }

  try {
    const response = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${ELEVENLABS_VOICE_ID}`,
      {
        method: "POST",
        headers: {
          "xi-api-key": process.env.ELEVENLABS_API_KEY,
          "Content-Type": "application/json",
          Accept: "audio/mpeg",
        },
        body: JSON.stringify({
          text,
          model_id: ELEVENLABS_MODEL_ID,
          voice_settings: {
            stability: 0.5,
            similarity_boost: 0.75,
          },
        }),
      }
    );

    if (!response.ok) {
      const errText = await response.text();
      res.status(500).json({ error: `ElevenLabs error: ${errText}` });
      return;
    }

    const audioBuffer = await response.arrayBuffer();
    res.set("Content-Type", "audio/mpeg");
    res.set("Content-Length", String(audioBuffer.byteLength));
    res.send(Buffer.from(audioBuffer));
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    res.status(500).json({ error: `TTS error: ${message}` });
  }
});

export default router;
