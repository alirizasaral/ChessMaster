import { Router } from "express";
import { GetQuipBody } from "@workspace/api-zod";

const router = Router();

router.post("/quip", async (req, res) => {
  const parseResult = GetQuipBody.safeParse(req.body);
  if (!parseResult.success) {
    res.status(400).json({ error: "Invalid request body" });
    return;
  }

  const { lessonName, userMove, moveNumber, recentMoves } = parseResult.data;

  if (!process.env.OPENAI_API_KEY) {
    res.status(500).json({ error: "OPENAI_API_KEY is not configured" });
    return;
  }

  // Recent move history helps the LLM understand context (last ~10 plies is plenty).
  const tail = (recentMoves ?? []).slice(-10).join(" ");

  const systemPrompt =
    "You are a snarky, theatrical chess grandmaster playing Black against a beginner who is practicing openings. " +
    "After every one of their moves, deliver ONE witty, lightly ridiculing one-liner about their move — like a pro wrestler's trash talk crossed with a chess commentator. " +
    "Be playful, never mean-spirited or vulgar. Vary your jokes: sometimes mock the move, sometimes feign concern, sometimes praise sarcastically, sometimes name-drop famous players. " +
    "Output ONLY the one-liner (max 20 words). No quotation marks, no preamble, no move notation echoed back unless it's part of the joke.";

  const userPrompt =
    `Lesson context: ${lessonName} (we're past the recorded mainline — this is free play).\n` +
    `Move number: ${moveNumber}\n` +
    `Recent moves: ${tail || "(none)"}\n` +
    `Opponent just played: ${userMove}\n\n` +
    `Give me ONE witty trash-talk line about their move.`;

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0.9,
        max_tokens: 60,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error(`OpenAI quip error status=${response.status} body=${errText}`);
      res.status(500).json({ error: `OpenAI error: ${errText}` });
      return;
    }

    const data = (await response.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const quip = (data.choices?.[0]?.message?.content ?? "").trim().replace(/^["']|["']$/g, "");
    res.json({ quip: quip || "Hmm. Interesting choice." });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    res.status(500).json({ error: `Quip error: ${message}` });
  }
});

export default router;
