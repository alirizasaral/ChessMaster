import { Router } from "express";
import { TextToSpeechBody } from "@workspace/api-zod";

const router = Router();

// OpenAI TTS — "nova" is a warm, calm female voice that fits a chess coach.
// Model "tts-1" is the fast, cheaper option (good enough for short lesson lines);
// "tts-1-hd" is higher quality but slower and pricier.
const OPENAI_VOICE = "nova";
const OPENAI_MODEL = "tts-1";

router.post("/tts", async (req, res) => {
  const parseResult = TextToSpeechBody.safeParse(req.body);
  if (!parseResult.success) {
    res.status(400).json({ error: "Invalid request body" });
    return;
  }

  const { text } = parseResult.data;

  if (!process.env.OPENAI_API_KEY) {
    res.status(500).json({ error: "OPENAI_API_KEY is not configured" });
    return;
  }

  try {
    const response = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
        Accept: "audio/mpeg",
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        voice: OPENAI_VOICE,
        input: text,
        response_format: "mp3",
        speed: 0.95,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error(`OpenAI TTS error status=${response.status} body=${errText}`);
      res.status(500).json({ error: `OpenAI TTS error: ${errText}` });
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
