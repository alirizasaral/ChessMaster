import { Router } from "express";
import OpenAI from "openai";
import type {
  ChatCompletionMessageParam,
  ChatCompletionTool,
} from "openai/resources/chat/completions";
import { GetCoachFeedbackBody } from "@workspace/api-zod";
import { detectOpenAiQuotaError } from "../lib/openai-quota-error.js";
import {
  buildCoachInstructions,
  buildCoachPersona,
} from "../lib/coach-prompts.js";
import {
  GET_CHAPTER_TOOL,
  formatUnknownChapterError,
  getChapterByTitle,
  listChapterTitles,
} from "../lib/knowledge-base.js";

const router = Router();

const MAX_TOOL_ROUNDS = 3;

function runGetChapterTool(argsJson: string): string {
  let title = "";
  try {
    const parsed = JSON.parse(argsJson) as { title?: unknown };
    if (typeof parsed.title === "string") title = parsed.title;
  } catch {
    return formatUnknownChapterError("");
  }
  const chapter = getChapterByTitle(title);
  if (!chapter) {
    return formatUnknownChapterError(title);
  }
  return `# ${chapter.title}\n\n${chapter.content}`;
}

router.post("/coach", async (req, res) => {
  const parseResult = GetCoachFeedbackBody.safeParse(req.body);
  if (!parseResult.success) {
    res.status(400).json({ error: "Invalid request body" });
    return;
  }

  const { trigger, mode, transcript, hint, userName } = parseResult.data;

  if (!process.env.OPENAI_API_KEY) {
    res.status(500).json({ error: "OPENAI_API_KEY is not configured" });
    return;
  }

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const system = buildCoachPersona(userName, listChapterTitles());
  const user = buildCoachInstructions({
    trigger,
    mode,
    transcript,
    hint,
    userName,
  });

  const messages: ChatCompletionMessageParam[] = [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
  const tools: ChatCompletionTool[] = [GET_CHAPTER_TOOL];

  try {
    let feedback = "No feedback available.";

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const completion = await client.chat.completions.create({
        model: "gpt-4o-mini",
        messages,
        tools,
        tool_choice: "auto",
        max_tokens: 600,
      });

      const message = completion.choices[0]?.message;
      if (!message) break;

      const toolCalls = message.tool_calls;
      if (!toolCalls || toolCalls.length === 0) {
        feedback = message.content?.trim() || feedback;
        break;
      }

      messages.push({
        role: "assistant",
        content: message.content ?? null,
        tool_calls: toolCalls,
      });

      for (const call of toolCalls) {
        if (call.type !== "function") continue;
        const output =
          call.function.name === "get_chapter"
            ? runGetChapterTool(call.function.arguments)
            : `Unknown tool: ${call.function.name}`;
        messages.push({
          role: "tool",
          tool_call_id: call.id,
          content: output,
        });
      }
    }

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
