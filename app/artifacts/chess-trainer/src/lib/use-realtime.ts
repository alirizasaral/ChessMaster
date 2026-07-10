import { useCallback, useEffect, useRef, useState } from "react";
import { formatGameTranscript, type GameEvent } from "@/lib/game-transcript";

/**
 * useRealtimeCoach
 *
 * Manages a WebRTC connection to OpenAI's Realtime API so the chess coach can:
 *   1. Speak witty, in-character commentary after every move
 *   2. Listen to the user via their microphone and respond conversationally
 *
 * Flow (https://platform.openai.com/docs/guides/realtime-webrtc):
 *   - Server mints an ephemeral session key (POST /api/realtime/session)
 *   - Client creates an RTCPeerConnection, captures mic, opens a data channel
 *   - Client POSTs its SDP offer to api.openai.com/v1/realtime?model=...
 *   - Client sets the SDP answer; audio + events flow over WebRTC
 *
 * Events are exchanged on the "oai-events" data channel as JSON.
 * `commentOnMove(ctx)` sends a `response.create` with move context as the
 * instructions, so the model improvises a fresh spoken comment each time.
 */

type Status = "idle" | "connecting" | "connected" | "error";

/**
 * Coach personality / context modes. Each one tweaks the system-level
 * framing the model uses when speaking. Switch with `setCoachMode()`.
 */
export type CoachMode = "lesson" | "free-play";

export type RealtimeTrigger =
  | "student_move"
  | "coach_move"
  | "off_line_move"
  | "undo"
  | "reset"
  | "game_over";

export interface RealtimeMoveContext {
  gameLog: GameEvent[];
  trigger: RealtimeTrigger;
  mode: string;
  hint?: string;
}

export interface RealtimeIntroContext {
  instructions: string;
  gameLog?: GameEvent[];
}

const TRIGGER_LABELS: Record<RealtimeTrigger, string> = {
  student_move: "The student (White) just played a move.",
  coach_move: "You (Black) just played a reply move.",
  off_line_move: "The student (White) played a move that is NOT on the lesson main line.",
  undo: "The student tapped undo and took back one or more moves.",
  reset: "The student reset the board to the starting position.",
  game_over: "The game just ended.",
};

function buildVerbosityLine(ctx: RealtimeMoveContext): string {
  if (ctx.trigger === "off_line_move") {
    return "Two short sentences: warn about the wrong move, state the correct move in spoken English, and ask them to tap undo to revert.";
  }
  if (ctx.trigger === "coach_move" && ctx.mode.startsWith("Lesson:")) {
    return "Two short sentences: react to your move, then state the next move the student should play in spoken English.";
  }
  if (ctx.hint?.includes("EXPLAIN")) {
    return "3–5 sentences max, still in character.";
  }
  if (ctx.hint?.toLowerCase().includes("next recommended student move")) {
    return "Two short sentences: include the next move the student should play in spoken English.";
  }
  return "One short sentence unless the hint requests a next-move mention or contains EXPLAIN.";
}

function buildRealtimeInstructions(ctx: RealtimeMoveContext, userName?: string): string {
  const transcript = formatGameTranscript(ctx.gameLog);
  const studentLabel = userName ?? "student";
  const parts = [
    `# Task`,
    `React to the latest chess event. Stay in character.`,
    ``,
    `# Current State`,
    `- Latest event: ${TRIGGER_LABELS[ctx.trigger]}`,
    `- Mode: ${ctx.mode}`,
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
  if (ctx.hint) {
    parts.push(``, `# Hint`, ctx.hint);
  }
  parts.push(
    ``,
    `# Verbosity for this turn`,
    buildVerbosityLine(ctx),
  );
  return parts.join("\n");
}

// SDP exchange endpoint for OpenAI Realtime GA. (The beta endpoint
// `/v1/realtime` was retired alongside the beta sessions API.)
const REALTIME_SDP_URL = "https://api.openai.com/v1/realtime/calls";

/** VAD + noise settings tuned for noisy environments (cafes, etc.). */
const REALTIME_AUDIO_INPUT = {
  turn_detection: {
    type: "semantic_vad" as const,
    eagerness: "low" as const,
    interrupt_response: false,
  },
  noise_reduction: { type: "near_field" as const },
  transcription: { model: "whisper-1" },
};

function buildCoachPersona(userName?: string): string {
  const studentRef = userName ?? "a complete beginner";
  const nameLine = userName
    ? `- The student's name is ${userName}. Address them by name occasionally.`
    : "";
  return `# Role and Objective
You are a snarky, theatrical chess grandmaster coaching ${studentRef} in live voice.
React to moves with witty one-liners, answer the student's chess questions in plain English, and lightly guide them in lesson mode.

# Personality and Tone
- Witty, theatrical, playful — pro-wrestler trash talk meets chess commentator
- Lightly ridiculing but never mean or vulgar
- Vary reactions: mock the move, feign concern, praise sarcastically, name-drop famous players
${nameLine}

# Language
- English is the default response language
- Use plain everyday English — the student does not know chess notation
- Refer to pieces by full names: pawn, knight, bishop, rook, queen, king
- Do not speak algebraic notation aloud (say "my knight to f3", not "Nf3")
- Square names like "e four" are fine when describing where a piece went
- Mention colors when it helps ("your white knight", "my black bishop")

# Roles
- The student plays the WHITE pieces; you play BLACK
- "I" = your black move; "you" = the student's white move
- If unsure about the position, trust the game transcript in each prompt

# Reasoning
- For move reactions and short acknowledgments, respond quickly without extended reasoning
- For "why" questions or explicit explanation requests, reason briefly before answering

# Preambles
- Skip preambles for move reactions — speak the comment directly
- Do not use filler like "Let me think...", "One moment...", or "I'll process that..."
- For explanatory answers to direct questions, skip preambles unless silence would feel unresponsive

# Verbosity
- Move reactions: 1 short sentence (10–15 spoken words)
- With a hint about the next move: up to 2 sentences
- Explanations (student asks why, or hint contains EXPLAIN): 3–5 sentences max, still in character
- Do not recap what they just saw on the board

# Unclear Audio
- Respond only when the student clearly speaks to you about chess
- If their speech is unclear but they seem to be addressing you, ask once: "Sorry, could you repeat that clearly?"
- Do not guess from unclear audio or reason when audio is unintelligible

# Background Noise
- Many students play in cafes with ambient chatter, music, and espresso machines
- Ignore background noise, side conversations, and speech not directed at you — stay silent
- Do not respond to silence, distant voices, or café ambiance
- Do not say "I didn't catch that" or "I'm here" for background noise alone
- Only speak when the student clearly asks you a chess question or makes a direct request

# Long Context Behavior
- The game transcript in each prompt is authoritative for position and moves
- Focus on the latest event unless the student asks about an earlier position

# Reference Pronunciations
- Say full piece names, not single letters
- Translate any notation in the transcript into spoken English before saying it

# Variety
- Do not reuse the same opener or catchphrase across turns

# Lesson Mode
- In lesson mode, after you play a reply move, always tell the student their next move in spoken English
- If the student plays an off-line move, warn them it is not the lesson main line, name the correct move in spoken English, and ask them to tap undo to revert`;
}

export function useRealtimeCoach({ userName }: { userName?: string } = {}) {
  const [status, setStatus] = useState<Status>("idle");
  const [isMicMuted, setMicMutedState] = useState(false);
  const [isAssistantSpeaking, setIsAssistantSpeaking] = useState(false);
  const [isReady, setIsReady] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  // Ref mirror of `isAssistantSpeaking` so callbacks see the latest value
  // without needing to be recreated on every change.
  const isSpeakingRef = useRef(false);
  // Tracks whether a response is currently in flight — set true the moment
  // we send `response.create` (so we can cancel even before audio starts
  // streaming), and reset on response lifecycle terminators.
  const responseActiveRef = useRef(false);
  const userNameRef = useRef(userName);

  useEffect(() => {
    userNameRef.current = userName;
  }, [userName]);

  const disconnect = useCallback(() => {
    if (dcRef.current) {
      try { dcRef.current.close(); } catch { /* noop */ }
      dcRef.current = null;
    }
    if (pcRef.current) {
      try { pcRef.current.close(); } catch { /* noop */ }
      pcRef.current = null;
    }
    if (micStreamRef.current) {
      micStreamRef.current.getTracks().forEach((t) => t.stop());
      micStreamRef.current = null;
    }
    if (audioElRef.current) {
      audioElRef.current.pause();
      audioElRef.current.srcObject = null;
      audioElRef.current = null;
    }
    setStatus("idle");
    setIsReady(false);
    isSpeakingRef.current = false;
    responseActiveRef.current = false;
    setIsAssistantSpeaking(false);
    setMicMutedState(false);
  }, []);

  /**
   * Cancel any in-flight assistant response so the coach stops speaking
   * immediately. Gated on `responseActiveRef` (not on speaking) so we still
   * cancel a response that's been requested but hasn't started streaming
   * audio yet — otherwise the stale reply would arrive and play after the
   * board state has already moved on (e.g. after a reset or rapid move).
   * Safe no-op when no response is in flight.
   */
  const interruptAssistant = useCallback(() => {
    const dc = dcRef.current;
    if (!dc || dc.readyState !== "open") return;
    if (!responseActiveRef.current) return;
    try {
      dc.send(JSON.stringify({ type: "response.cancel" }));
    } catch {
      /* noop */
    }
    responseActiveRef.current = false;
    isSpeakingRef.current = false;
    setIsAssistantSpeaking(false);
  }, []);

  const connect = useCallback(async () => {
    if (status === "connecting" || status === "connected") return;
    setStatus("connecting");
    setLastError(null);

    try {
      // 1) Get an ephemeral session key from our server.
      const BASE_URL = import.meta.env.BASE_URL;
      const sessionResp = await fetch(`${BASE_URL}api/realtime/session`, { method: "POST" });
      if (!sessionResp.ok) {
        throw new Error(`Realtime session create failed: ${sessionResp.status}`);
      }
      // GA shape: { value: "ek_...", expires_at: ..., session: {...}, model: "..." }
      // Beta shape (deprecated): { client_secret: { value: "..." }, ... }
      const session = (await sessionResp.json()) as {
        value?: string;
        client_secret?: { value?: string };
        model?: string;
      };
      const ephemeralKey = session.value ?? session.client_secret?.value;
      const model = session.model ?? "gpt-realtime-2";
      if (!ephemeralKey) throw new Error("Realtime session returned no ephemeral key");

      // 2) Build the peer connection.
      const pc = new RTCPeerConnection();
      pcRef.current = pc;

      // 3) Play remote audio (the assistant's voice) through a hidden <audio> element.
      const audioEl = document.createElement("audio");
      audioEl.autoplay = true;
      audioElRef.current = audioEl;
      pc.ontrack = (e) => {
        if (audioElRef.current) audioElRef.current.srcObject = e.streams[0];
      };

      // 4) Capture mic and add it to the peer connection.
      //    getUserMedia must be called from a user gesture — this hook should
      //    only be invoked from a click handler.
      const micStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      micStreamRef.current = micStream;
      micStream.getTracks().forEach((t) => pc.addTrack(t, micStream));

      // 5) Open the events data channel.
      const dc = pc.createDataChannel("oai-events");
      dcRef.current = dc;

      dc.addEventListener("open", () => {
        setIsReady(true);
        // Configure the session: persona, voice activity detection, transcription.
        // GA event shape (https://platform.openai.com/docs/api-reference/realtime-client-events/session/update):
        //   session.type = "realtime", instructions on the session, audio.input/output settings.
        dc.send(
          JSON.stringify({
            type: "session.update",
            session: {
              type: "realtime",
              instructions: buildCoachPersona(userNameRef.current),
              reasoning: { effort: "minimal" },
              output_modalities: ["audio"],
              audio: {
                input: REALTIME_AUDIO_INPUT,
                output: { voice: "marin" },
              },
            },
          }),
        );
      });

      dc.addEventListener("message", (e) => {
        try {
          const evt = JSON.parse(e.data) as { type?: string };
          // Track speaking state so the UI can show a "speaking" indicator.
          if (evt.type === "response.created") {
            responseActiveRef.current = true;
          } else if (
            evt.type === "response.audio.delta" ||
            evt.type === "response.output_audio.delta"
          ) {
            responseActiveRef.current = true;
            isSpeakingRef.current = true;
            setIsAssistantSpeaking(true);
          } else if (
            evt.type === "response.done" ||
            evt.type === "response.audio.done" ||
            evt.type === "response.output_audio.done" ||
            evt.type === "response.cancelled"
          ) {
            responseActiveRef.current = false;
            isSpeakingRef.current = false;
            setIsAssistantSpeaking(false);
          } else if (evt.type === "error") {
            console.error("Realtime API error:", evt);
          } else if (
            evt.type === "session.created" ||
            evt.type === "session.updated"
          ) {
            // Helpful for debugging — confirms persona/voice took effect.
            console.debug("Realtime session event:", evt.type);
          }
        } catch {
          /* ignore malformed events */
        }
      });

      pc.addEventListener("connectionstatechange", () => {
        const s = pc.connectionState;
        if (s === "failed" || s === "disconnected" || s === "closed") {
          // Fully tear down the peer/mic/audio so a later connect() doesn't
          // stack a second RTCPeerConnection on top of the dead one and so
          // the microphone is actually released. Guarded by ref-equality:
          // only disconnect if this is still the *active* peer connection
          // (avoids tearing down a fresh reconnect that beat us to it).
          if (pcRef.current === pc) {
            disconnect();
          }
        }
      });

      // 6) Exchange SDP with OpenAI.
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      const sdpResp = await fetch(
        `${REALTIME_SDP_URL}?model=${encodeURIComponent(model)}`,
        {
          method: "POST",
          body: offer.sdp,
          headers: {
            Authorization: `Bearer ${ephemeralKey}`,
            "Content-Type": "application/sdp",
          },
        },
      );
      if (!sdpResp.ok) {
        const text = await sdpResp.text();
        throw new Error(`SDP exchange failed (${sdpResp.status}): ${text}`);
      }
      const answerSdp = await sdpResp.text();
      await pc.setRemoteDescription({ type: "answer", sdp: answerSdp });

      setStatus("connected");
    } catch (err) {
      console.error("Realtime connect failed:", err);
      const message = err instanceof Error ? err.message : String(err);
      disconnect();
      setLastError(message);
      setStatus("error");
    }
  }, [status, disconnect]);

  /**
   * Ask the realtime model to comment on what just happened.
   * Sends the full annotated game transcript plus a trigger label and optional hint.
   * Silently no-ops if not connected.
   */
  const commentOnMove = useCallback((ctx: RealtimeMoveContext) => {
    const dc = dcRef.current;
    if (!dc || dc.readyState !== "open") return;
    // Interrupt any in-flight response (speaking OR just-requested but not
    // streaming yet) so we react to the latest move instead of finishing
    // yesterday's joke or letting a stale reply land after a reset.
    if (responseActiveRef.current) {
      try {
        dc.send(JSON.stringify({ type: "response.cancel" }));
      } catch {
        /* noop */
      }
      responseActiveRef.current = false;
      isSpeakingRef.current = false;
      setIsAssistantSpeaking(false);
    }
    // Mark the new response as active immediately — sending response.create
    // makes one in-flight even before the server echoes response.created.
    responseActiveRef.current = true;
    dc.send(
      JSON.stringify({
        type: "response.create",
        response: {
          output_modalities: ["audio"],
          instructions: buildRealtimeInstructions(ctx, userNameRef.current),
        },
      }),
    );
  }, []);

  /**
   * Send an arbitrary instruction prompt to the coach. Useful for intros,
   * mode switches, or other system-level utterances that aren't a reaction
   * to a specific move. Interrupts any in-flight response first.
   */
  const speakIntro = useCallback(({ instructions, gameLog }: RealtimeIntroContext) => {
    const dc = dcRef.current;
    if (!dc || dc.readyState !== "open") return;
    if (responseActiveRef.current) {
      try {
        dc.send(JSON.stringify({ type: "response.cancel" }));
      } catch {
        /* noop */
      }
      responseActiveRef.current = false;
      isSpeakingRef.current = false;
      setIsAssistantSpeaking(false);
    }
    responseActiveRef.current = true;

    const studentLabel = userNameRef.current ?? "student";
    const transcriptBlock =
      gameLog && gameLog.length > 0
        ? `\n\n# Authoritative Source — Game Transcript\n(${studentLabel} = White, coach = Black)\n\n${formatGameTranscript(gameLog)}`
        : "";

    dc.send(
      JSON.stringify({
        type: "response.create",
        response: {
          output_modalities: ["audio"],
          instructions: `# Task\n${instructions}${transcriptBlock}`,
        },
      }),
    );
  }, []);

  const setMicMuted = useCallback((muted: boolean) => {
    const stream = micStreamRef.current;
    if (stream) {
      stream.getAudioTracks().forEach((t) => {
        t.enabled = !muted;
      });
    }
    setMicMutedState(muted);
  }, []);

  // Clean up on unmount.
  useEffect(() => {
    return () => {
      disconnect();
    };
  }, [disconnect]);

  return {
    status,
    isReady,
    isMicMuted,
    isAssistantSpeaking,
    lastError,
    connect,
    disconnect,
    commentOnMove,
    speakIntro,
    interruptAssistant,
    setMicMuted,
  };
}
