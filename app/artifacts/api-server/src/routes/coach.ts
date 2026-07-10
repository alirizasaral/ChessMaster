import { Router } from "express";
import OpenAI from "openai";
import { GetCoachFeedbackBody } from "@workspace/api-zod";
import { detectOpenAiQuotaError } from "../lib/openai-quota-error.js";

const router = Router();

router.post("/coach", async (req, res) => {
  const parseResult = GetCoachFeedbackBody.safeParse(req.body);
  if (!parseResult.success) {
    res.status(400).json({ error: "Invalid request body" });
    return;
  }

  const { lessonId, lessonName, fen, moves, lastMove } = parseResult.data;

  if (!process.env.OPENAI_API_KEY) {
    res.status(500).json({ error: "OPENAI_API_KEY is not configured" });
    return;
  }

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const movesString = moves.length > 0 ? moves.join(", ") : "none yet";

  const prompt = `You are a friendly chess opening coach helping a beginner learn the ${lessonName}.

Current board state (FEN): ${fen}
Move history: ${movesString}
Last move played: ${lastMove}

Provide coaching feedback in this exact format:

Move feedback: [Good / Playable / Risky / Mistake]

Pros:
- [pro 1]
- [pro 2]

Cons:
- [con 1]

Better alternatives:
1. [alternative move with brief reason]
2. [alternative move with brief reason]

Next idea:
[One short sentence suggesting what to think about next]

Rules:
- Keep it short and beginner-friendly (under 120 words total)
- Focus on opening principles (center control, development, king safety)
- Never claim a move is illegal
- Be encouraging, not harsh
- Explain why the move fits or doesn't fit the ${lessonName}`;

  try {
    const completion = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      max_tokens: 300,
    });

    const feedback = completion.choices[0]?.message?.content ?? "No feedback available.";
    res.json({ feedback });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    const payload: { error: string; code?: string } = {
      error: `OpenAI error: ${message}`,
    };
    if (detectOpenAiQuotaError(undefined, message)) {
      payload.code = "insufficient_funds";
    }
    res.status(500).json(payload);
  }
});

export default router;
