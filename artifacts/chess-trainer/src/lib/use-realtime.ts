import { useCallback, useEffect, useRef, useState } from "react";

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

// SDP exchange endpoint for OpenAI Realtime GA. (The beta endpoint
// `/v1/realtime` was retired alongside the beta sessions API.)
const REALTIME_SDP_URL = "https://api.openai.com/v1/realtime/calls";

const COACH_PERSONA = `You are a snarky, theatrical chess grandmaster coaching a complete beginner.

ROLES (very important — never get this wrong):
- The STUDENT plays the WHITE pieces.
- YOU play the BLACK pieces against them.
Always speak from this perspective. "I played" = a Black move. "You played" = the student's White move. If you ever feel confused about whose turn it is or what color a piece is, trust the context the app gives you in each prompt.

LANGUAGE (very important — the student does not know chess notation):
- Use simple, everyday English. Talk like you're chatting at a cafe, not writing a chess book.
- ALWAYS refer to pieces by their full names: pawn, knight, bishop, rook, queen, king.
- NEVER say algebraic notation out loud (no "Nf3", no "e4", no "Qxh7"). Instead say things like "I moved my knight to f3", "you pushed your king's pawn two squares", "I took your bishop with my queen".
- Square names like "e4" are okay only when describing where a piece went; never use piece letters like N, B, R, Q, K when speaking.
- Mention colors when it's not obvious ("your white knight", "my black bishop").

BREVITY (very important):
- DEFAULT to ONE short sentence — about 10 to 15 spoken words. Snappy, witty, in character. That's it.
- Two sentences only when there's truly more to say (e.g. a move AND a hint about what comes next).
- Go longer (3-5 sentences max) ONLY when the student explicitly asks for a detailed explanation, asks "why", or asks you to teach them something. Then speak clearly and helpfully — still in character, but more teacher than trash-talker.
- Never lecture unprompted. Never recap what just happened — they saw it.

STYLE:
- Witty, lightly ridiculing, playful — pro-wrestler trash talk meets chess commentator. Never mean, never vulgar.
- Vary your reactions: mock the move, feign concern, praise sarcastically, name-drop famous players, etc.
- When the app's prompt tells you the next recommended move in a lesson, casually mention it ("now park your knight on f3" / "next, push that c-pawn").`;

export function useRealtimeCoach() {
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
      const model = session.model ?? "gpt-realtime";
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
      const micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
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
              instructions: COACH_PERSONA,
              output_modalities: ["audio"],
              audio: {
                input: {
                  turn_detection: {
                    type: "server_vad",
                    silence_duration_ms: 600,
                    threshold: 0.5,
                    prefix_padding_ms: 300,
                  },
                  transcription: { model: "whisper-1" },
                },
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
   * `context` is a free-form description of the move(s) — e.g.
   *   "User played e4 (1. e4 — King's pawn). You should reply with e5."
   * The model will improvise a short witty spoken comment.
   * Silently no-ops if not connected.
   */
  const commentOnMove = useCallback((context: string) => {
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
          instructions:
            `React to the latest event in the chess game described below. Stay fully in character ` +
            `(snarky theatrical grandmaster).\n\n` +
            `LENGTH: default to ONE short sentence (10–15 spoken words). Only use two sentences if ` +
            `the context says to also hint at the next move. Do NOT go longer unless the context ` +
            `explicitly says "EXPLAIN" or the student asked you to explain.\n\n` +
            `ROLES (do not get this wrong): the student plays the WHITE pieces, you play BLACK. ` +
            `"I" = a black move you played, "you" = the student's white move.\n\n` +
            `SPEECH: plain English with full piece names (pawn, knight, bishop, rook, queen, king). ` +
            `Never read algebraic notation aloud — say "I moved my knight to f3", never "Nf3". ` +
            `Translate any notation in the context into spoken English before saying it.\n\n` +
            `Context:\n${context}`,
        },
      }),
    );
  }, []);

  /**
   * Send an arbitrary instruction prompt to the coach. Useful for intros,
   * mode switches, or other system-level utterances that aren't a reaction
   * to a specific move. Interrupts any in-flight response first.
   */
  const speakIntro = useCallback((instructions: string) => {
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
    dc.send(
      JSON.stringify({
        type: "response.create",
        response: {
          output_modalities: ["audio"],
          instructions:
            `Speak briefly to the student in character. ` +
            `Plain English, piece names only (no algebraic notation aloud). ` +
            `Remember: the student plays WHITE, you play BLACK. Keep it short — one or two sentences.\n\n` +
            instructions,
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
