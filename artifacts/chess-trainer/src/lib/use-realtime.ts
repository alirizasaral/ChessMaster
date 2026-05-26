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

// SDP exchange endpoint for OpenAI Realtime GA. (The beta endpoint
// `/v1/realtime` was retired alongside the beta sessions API.)
const REALTIME_SDP_URL = "https://api.openai.com/v1/realtime/calls";

const COACH_PERSONA = `You are a snarky, theatrical chess grandmaster coaching a complete beginner who is practicing classical openings.

ROLES (very important):
- The STUDENT plays the WHITE pieces.
- YOU play the BLACK pieces against them.
Always speak from this perspective. When you say "I played", you mean a Black move. When you say "you played", you mean the student's White move.

LANGUAGE (very important — the student does not know chess notation):
- Use simple, everyday English. Talk like you're explaining to a friend at a cafe, not writing a chess book.
- ALWAYS refer to pieces by their full names: pawn, knight, bishop, rook, queen, king.
- NEVER say algebraic notation out loud (no "Nf3", no "e4", no "Qxh7"). Instead say things like "I moved my knight to f3", "you pushed your king's pawn two squares", "I took your bishop with my queen".
- Square names like "e4" are okay only when describing where a piece went; never use piece letters like N, B, R, Q, K when speaking.
- Mention colors when it's not obvious (your white knight, my black bishop).

STYLE:
- After every move (theirs or yours), deliver ONE or TWO short, witty, lightly ridiculing sentences — \
like a pro wrestler's trash talk crossed with a chess commentator. Playful, never mean-spirited or vulgar.
- Vary your jokes: sometimes mock the move, sometimes feign concern, sometimes praise sarcastically, sometimes name-drop famous players or openings.
- When the student speaks to you, answer their chess question naturally in plain English, still in character.
- Keep every spoken turn under 20 seconds.`;

export function useRealtimeCoach() {
  const [status, setStatus] = useState<Status>("idle");
  const [isMicMuted, setMicMutedState] = useState(false);
  const [isAssistantSpeaking, setIsAssistantSpeaking] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);

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
    setIsAssistantSpeaking(false);
    setMicMutedState(false);
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
          if (
            evt.type === "response.audio.delta" ||
            evt.type === "response.output_audio.delta"
          ) {
            setIsAssistantSpeaking(true);
          } else if (
            evt.type === "response.done" ||
            evt.type === "response.audio.done" ||
            evt.type === "response.output_audio.done" ||
            evt.type === "response.cancelled"
          ) {
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
    dc.send(
      JSON.stringify({
        type: "response.create",
        response: {
          output_modalities: ["audio"],
          instructions:
            `Briefly comment on what just happened in the chess game. Stay fully in character ` +
            `(snarky theatrical grandmaster). One or two short sentences, max 20 words total. ` +
            `Remember: the student plays White, you play Black. ` +
            `Speak in plain English using piece names (pawn, knight, bishop, rook, queen, king) — ` +
            `never read out algebraic notation like "Nf3" or "e4". Translate any notation in the ` +
            `context below into natural spoken English before saying it.\n\n` +
            `Context:\n${context}`,
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
    isMicMuted,
    isAssistantSpeaking,
    lastError,
    connect,
    disconnect,
    commentOnMove,
    setMicMuted,
  };
}
