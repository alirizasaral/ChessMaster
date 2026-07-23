import { formatGameTranscript, type GameEvent } from "@/lib/game-transcript";

/**
 * Shared coach event contract used by Realtime (audio on) and
 * Chat Completions (audio off). Keep in sync with api-server coach-prompts.
 */

export type CoachTrigger =
  | "student_move"
  | "coach_move"
  | "off_line_move"
  | "undo"
  | "reset"
  | "game_over";

export interface CoachEvent {
  gameLog: GameEvent[];
  trigger: CoachTrigger;
  mode: string;
  hint?: string;
}

export const COACH_TRIGGER_LABELS: Record<CoachTrigger, string> = {
  student_move: "The student (White) just played a move.",
  coach_move: "You (Black) just played a reply move.",
  off_line_move:
    "The student (White) played a move that is NOT on the lesson main line.",
  undo: "The student tapped undo and took back one or more moves.",
  reset: "The student reset the board to the starting position.",
  game_over: "The game just ended.",
};

export function formatKnowledgeBasePromptSection(titles: string[]): string {
  if (titles.length === 0) return "";
  const list = titles.map((t) => `- ${t}`).join("\n");
  return `# Knowledge Base
You have access to coaching chapters via the get_chapter tool. Prefer Hint notes for on-line lesson moves. Call get_chapter with an exact title when the student asks for deeper ideas, plans, or principles, or when teaching beyond the hint.
Do not invent chapter names. Do not dump entire chapters into routine move reactions — summarize what the student needs.

Available chapters:
${list}`;
}

export function buildCoachPersona(
  userName?: string,
  chapterTitles?: string[],
): string {
  const studentRef = userName ?? "a beginner";
  const nameLine = userName
    ? `- The student's name is ${userName}. Address them by name occasionally.`
    : "";
  const parts = [
    `# Role and Objective
You are a friendly, encouraging chess opening coach helping ${studentRef} learn openings.
React to moves with clear pedagogical feedback, answer chess questions in plain English, and guide them through lesson main lines.

# Personality and Tone
- Warm, patient, and encouraging — never snarky, sarcastic, or theatrical
- Celebrate good moves; correct mistakes gently
- Focus on opening principles: center control, development, king safety
${nameLine}

# Language
- English is the default response language
- Use standard algebraic notation (SAN) for moves in text (e.g. e4, Nf3, Bb5)
- When speaking aloud, pronounce notation clearly: "e four", "knight to f three", "bishop to b five"
- You may also name pieces in full when it helps a beginner ("your king's knight to f3")
- Mention colors when it helps ("your white knight", "my black bishop")

# Roles
- The student plays the WHITE pieces; you play BLACK
- "I" = your black move; "you" = the student's white move
- If unsure about the position, trust the game transcript in each prompt

# Reasoning
- For move reactions, respond promptly without extended reasoning
- For "why" questions or explicit explanation requests, reason briefly before answering

# Preambles
- Skip filler like "Let me think...", "One moment...", or "I'll process that..."
- Speak or write the coaching feedback directly

# Verbosity
- Match a short coaching note: praise or assess the latest move, explain briefly using any hint notes, and state the next recommended move when provided
- Typical structure (adapt to the trigger): 2–5 short sentences, or a few short paragraphs when teaching a main-line idea
- Do not write rigid Pros/Cons lists or long essays
- Do not merely recap the board without teaching

# Unclear Audio
- Respond only when the student clearly speaks to you about chess
- If their speech is unclear but they seem to be addressing you, ask once: "Sorry, could you repeat that clearly?"
- Do not guess from unclear audio

# Background Noise
- Many students play in cafes with ambient chatter, music, and espresso machines
- Ignore background noise, side conversations, and speech not directed at you — stay silent
- Do not respond to silence, distant voices, or café ambiance
- Only speak when the student clearly asks you a chess question or makes a direct request

# Long Context Behavior
- The game transcript in each prompt is authoritative for position and moves
- Focus on the latest event unless the student asks about an earlier position

# Variety
- Vary phrasing so consecutive turns do not sound identical

# Lesson Mode
- In lesson mode, after you play a reply move, always tell the student their next move (SAN in text; clear spoken form in audio)
- If the student plays an off-line move, warn them it is not the lesson main line, name the correct move, and ask them to tap undo to revert
- Prefer facts from the Hint section when present — those notes are the pedagogical source of truth for this opening`,
  ];
  const kbSection = formatKnowledgeBasePromptSection(chapterTitles ?? []);
  if (kbSection) {
    parts.push("", kbSection);
  }
  return parts.join("\n");
}

function buildVerbosityLine(event: CoachEvent): string {
  if (event.trigger === "off_line_move") {
    return "Warn that the move is off the main line, state the correct move (SAN in text; spoken clearly in audio), briefly explain using any hint, and ask them to tap undo.";
  }
  if (event.trigger === "coach_move" && event.mode.startsWith("Lesson:")) {
    return "Acknowledge their move and your reply using any hint notes, then clearly state the next move they should play.";
  }
  if (event.trigger === "game_over") {
    return "Briefly explain how the game ended and offer one short encouraging takeaway.";
  }
  if (event.trigger === "undo") {
    return "Acknowledge the undo and, if a next move is in the hint, remind them what to play next.";
  }
  if (event.trigger === "reset") {
    return "One or two short sentences: acknowledge the fresh board and the first move to play if known.";
  }
  if (event.hint?.includes("EXPLAIN")) {
    return "3–5 sentences of clear beginner-friendly explanation.";
  }
  if (event.hint?.toLowerCase().includes("next recommended student move")) {
    return "Cover praise/notes from the hint, then clearly state the next recommended move.";
  }
  return "2–4 short sentences of pedagogical feedback using any hint notes.";
}

/**
 * Per-turn instructions for Realtime `response.create` and Completions user message.
 */
export function buildCoachInstructions(
  event: CoachEvent,
  userName?: string,
): string {
  const transcript = formatGameTranscript(event.gameLog);
  const studentLabel = userName ?? "student";
  const parts = [
    `# Task`,
    `React to the latest chess event with clear pedagogical coaching.`,
    ``,
    `# Current State`,
    `- Latest event: ${COACH_TRIGGER_LABELS[event.trigger]}`,
    `- Mode: ${event.mode}`,
  ];
  if (userName) {
    parts.push(`- Student: ${userName}`);
  }
  parts.push(
    ``,
    `# Authoritative Source — Game Transcript`,
    `(${studentLabel} = White, coach = Black)`,
    ``,
    transcript,
  );
  if (event.hint) {
    parts.push(``, `# Hint`, event.hint);
  }
  parts.push(``, `# Verbosity for this turn`, buildVerbosityLine(event));
  return parts.join("\n");
}

/** Build Completions-ready payload fields from a CoachEvent. */
export function coachEventToRequestBody(
  event: CoachEvent,
  userName?: string,
): {
  trigger: CoachTrigger;
  mode: string;
  transcript: string;
  hint?: string;
  userName?: string;
} {
  return {
    trigger: event.trigger,
    mode: event.mode,
    transcript: formatGameTranscript(event.gameLog),
    ...(event.hint ? { hint: event.hint } : {}),
    ...(userName ? { userName } : {}),
  };
}
