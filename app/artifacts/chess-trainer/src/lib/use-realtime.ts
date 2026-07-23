import { useCallback, useEffect, useRef, useState } from "react";
import { formatGameTranscript, type GameEvent } from "@/lib/game-transcript";
import {
  buildCoachInstructions,
  buildCoachPersona,
  type CoachEvent,
  type CoachTrigger,
} from "@/lib/coach-prompts";
import {
  buildGetChapterRealtimeTool,
  fetchChapterContent,
  fetchChapterTitles,
  GET_CHAPTER_TOOL_NAME,
  parseGetChapterTitle,
} from "@/lib/knowledge-base-tool";
import {
  detectOpenAiQuotaError,
  type VoiceCoachErrorKind,
} from "@/lib/openai-quota-error";

/**
 * useRealtimeCoach
 *
 * Manages a WebRTC connection to OpenAI's Realtime API so the chess coach can:
 *   1. Speak pedagogical commentary after every move
 *   2. Emit transcripts so the chat panel matches what was said
 *   3. Listen to the user via their microphone and respond conversationally
 *   4. Call get_chapter to load knowledge-base content when needed
 *
 * Flow (https://platform.openai.com/docs/guides/realtime-webrtc):
 *   - Server mints an ephemeral session key (POST /api/realtime/session)
 *   - Client creates an RTCPeerConnection, captures mic, opens a data channel
 *   - Client POSTs its SDP offer to api.openai.com/v1/realtime/calls
 *   - Client sets the SDP answer; audio + events flow over WebRTC
 */

type Status = "idle" | "connecting" | "connected" | "error";

export type CoachMode = "lesson" | "free-play";

/** @deprecated Use CoachTrigger from coach-prompts */
export type RealtimeTrigger = CoachTrigger;

/** @deprecated Use CoachEvent from coach-prompts */
export type RealtimeMoveContext = CoachEvent;

export interface RealtimeIntroContext {
  instructions: string;
  gameLog?: GameEvent[];
}

export interface UseRealtimeCoachOptions {
  userName?: string;
  onAssistantTranscript?: (text: string) => void;
  onUserTranscript?: (text: string) => void;
}

// SDP exchange endpoint for OpenAI Realtime GA.
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

type RealtimeFunctionCallItem = {
  type?: string;
  name?: string;
  call_id?: string;
  arguments?: string;
};

type RealtimeServerEvent = {
  type?: string;
  transcript?: string;
  delta?: string;
  call_id?: string;
  name?: string;
  arguments?: string;
  response?: {
    output?: RealtimeFunctionCallItem[];
  };
};

function extractFunctionCallsFromDone(
  evt: RealtimeServerEvent,
): RealtimeFunctionCallItem[] {
  const output = evt.response?.output;
  if (!Array.isArray(output)) return [];
  return output.filter(
    (item) =>
      item?.type === "function_call" &&
      typeof item.call_id === "string" &&
      typeof item.name === "string",
  );
}

export function useRealtimeCoach({
  userName,
  onAssistantTranscript,
  onUserTranscript,
}: UseRealtimeCoachOptions = {}) {
  const [status, setStatus] = useState<Status>("idle");
  const [isMicMuted, setMicMutedState] = useState(false);
  const [isAssistantSpeaking, setIsAssistantSpeaking] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isReady, setIsReady] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);
  const [errorKind, setErrorKind] = useState<VoiceCoachErrorKind | null>(null);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const isSpeakingRef = useRef(false);
  const responseActiveRef = useRef(false);
  /** True while waiting to send function_call_output + response.create. */
  const pendingToolCallRef = useRef(false);
  /** Deduplicate tool handling across function_call_arguments.done and response.done. */
  const handledCallIdsRef = useRef(new Set<string>());
  /** Discard partial assistant text when the response is cancelled. */
  const cancelledResponseRef = useRef(false);
  const assistantTranscriptBufRef = useRef("");
  /** Prevents double-append if transcript.done and response.done both carry text. */
  const assistantTranscriptEmittedRef = useRef(false);
  const userNameRef = useRef(userName);
  const onAssistantTranscriptRef = useRef(onAssistantTranscript);
  const onUserTranscriptRef = useRef(onUserTranscript);

  useEffect(() => {
    userNameRef.current = userName;
  }, [userName]);

  useEffect(() => {
    onAssistantTranscriptRef.current = onAssistantTranscript;
  }, [onAssistantTranscript]);

  useEffect(() => {
    onUserTranscriptRef.current = onUserTranscript;
  }, [onUserTranscript]);

  const markResponseEnded = useCallback(() => {
    responseActiveRef.current = false;
    isSpeakingRef.current = false;
    setIsAssistantSpeaking(false);
    setIsGenerating(false);
  }, []);

  const disconnect = useCallback(() => {
    if (dcRef.current) {
      try {
        dcRef.current.close();
      } catch {
        /* noop */
      }
      dcRef.current = null;
    }
    if (pcRef.current) {
      try {
        pcRef.current.close();
      } catch {
        /* noop */
      }
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
    pendingToolCallRef.current = false;
    handledCallIdsRef.current.clear();
    cancelledResponseRef.current = false;
    assistantTranscriptBufRef.current = "";
    assistantTranscriptEmittedRef.current = false;
    setIsAssistantSpeaking(false);
    setIsGenerating(false);
    setMicMutedState(false);
  }, []);

  const flushAssistantTranscript = useCallback((explicit?: string) => {
    if (cancelledResponseRef.current || assistantTranscriptEmittedRef.current) {
      assistantTranscriptBufRef.current = "";
      return;
    }
    const text =
      (explicit && explicit.trim()) || assistantTranscriptBufRef.current.trim();
    assistantTranscriptBufRef.current = "";
    if (!text) return;
    assistantTranscriptEmittedRef.current = true;
    onAssistantTranscriptRef.current?.(text);
  }, []);

  const interruptAssistant = useCallback(() => {
    const dc = dcRef.current;
    if (!dc || dc.readyState !== "open") return;
    if (!responseActiveRef.current && !pendingToolCallRef.current) return;
    try {
      dc.send(JSON.stringify({ type: "response.cancel" }));
    } catch {
      /* noop */
    }
    cancelledResponseRef.current = true;
    pendingToolCallRef.current = false;
    assistantTranscriptBufRef.current = "";
    assistantTranscriptEmittedRef.current = true;
    markResponseEnded();
  }, [markResponseEnded]);

  const beginNewResponse = useCallback(() => {
    const dc = dcRef.current;
    if (!dc || dc.readyState !== "open") return false;
    if (responseActiveRef.current || pendingToolCallRef.current) {
      try {
        dc.send(JSON.stringify({ type: "response.cancel" }));
      } catch {
        /* noop */
      }
      cancelledResponseRef.current = true;
      pendingToolCallRef.current = false;
      assistantTranscriptBufRef.current = "";
      assistantTranscriptEmittedRef.current = true;
      markResponseEnded();
    }
    cancelledResponseRef.current = false;
    assistantTranscriptBufRef.current = "";
    assistantTranscriptEmittedRef.current = false;
    responseActiveRef.current = true;
    setIsGenerating(true);
    return true;
  }, [markResponseEnded]);

  const fulfillFunctionCall = useCallback(
    async (call: { call_id: string; name: string; arguments: string }) => {
      const dc = dcRef.current;
      if (!dc || dc.readyState !== "open") return;
      if (handledCallIdsRef.current.has(call.call_id)) return;
      handledCallIdsRef.current.add(call.call_id);

      pendingToolCallRef.current = true;
      responseActiveRef.current = true;
      setIsGenerating(true);

      let output = `Unknown tool: ${call.name}`;
      if (call.name === GET_CHAPTER_TOOL_NAME) {
        const title = parseGetChapterTitle(call.arguments);
        const BASE_URL = import.meta.env.BASE_URL;
        output = await fetchChapterContent(BASE_URL, title);
      }

      // Connection may have closed while fetching.
      if (dcRef.current !== dc || dc.readyState !== "open") return;
      if (cancelledResponseRef.current) {
        pendingToolCallRef.current = false;
        return;
      }

      try {
        dc.send(
          JSON.stringify({
            type: "conversation.item.create",
            item: {
              type: "function_call_output",
              call_id: call.call_id,
              output,
            },
          }),
        );
        pendingToolCallRef.current = false;
        responseActiveRef.current = true;
        setIsGenerating(true);
        dc.send(
          JSON.stringify({
            type: "response.create",
            response: {
              output_modalities: ["audio"],
            },
          }),
        );
      } catch (err) {
        console.error("Failed to return function call output:", err);
        pendingToolCallRef.current = false;
        markResponseEnded();
      }
    },
    [markResponseEnded],
  );

  const connect = useCallback(async () => {
    if (status === "connecting" || status === "connected") return;
    setStatus("connecting");
    setLastError(null);
    setErrorKind(null);

    try {
      const BASE_URL = import.meta.env.BASE_URL;
      const sessionResp = await fetch(`${BASE_URL}api/realtime/session`, {
        method: "POST",
      });
      if (!sessionResp.ok) {
        const body = await sessionResp.text();
        const isQuota = detectOpenAiQuotaError(sessionResp.status, body);
        setErrorKind(isQuota ? "quota" : "generic");
        let message = `Realtime session create failed: ${sessionResp.status}`;
        try {
          const parsed = JSON.parse(body) as { error?: string };
          if (parsed.error) message = parsed.error;
        } catch {
          if (body) message = body;
        }
        throw new Error(message);
      }
      const session = (await sessionResp.json()) as {
        value?: string;
        client_secret?: { value?: string };
        model?: string;
      };
      const ephemeralKey = session.value ?? session.client_secret?.value;
      const model = session.model ?? "gpt-realtime-2";
      if (!ephemeralKey) throw new Error("Realtime session returned no ephemeral key");

      const chapterTitles = await fetchChapterTitles(BASE_URL);

      const pc = new RTCPeerConnection();
      pcRef.current = pc;

      const audioEl = document.createElement("audio");
      audioEl.autoplay = true;
      audioElRef.current = audioEl;
      pc.ontrack = (e) => {
        if (audioElRef.current) audioElRef.current.srcObject = e.streams[0];
      };

      const micStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      micStreamRef.current = micStream;
      micStream.getTracks().forEach((t) => pc.addTrack(t, micStream));

      const dc = pc.createDataChannel("oai-events");
      dcRef.current = dc;

      dc.addEventListener("open", () => {
        setIsReady(true);
        handledCallIdsRef.current.clear();
        const sessionPayload: Record<string, unknown> = {
          type: "realtime",
          instructions: buildCoachPersona(userNameRef.current, chapterTitles),
          reasoning: { effort: "minimal" },
          output_modalities: ["audio"],
          audio: {
            input: REALTIME_AUDIO_INPUT,
            output: { voice: "marin" },
          },
        };
        if (chapterTitles.length > 0) {
          sessionPayload.tools = [buildGetChapterRealtimeTool(chapterTitles)];
          sessionPayload.tool_choice = "auto";
        }
        dc.send(
          JSON.stringify({
            type: "session.update",
            session: sessionPayload,
          }),
        );
      });

      dc.addEventListener("message", (e) => {
        try {
          const evt = JSON.parse(e.data) as RealtimeServerEvent;
          const type = evt.type ?? "";

          if (type === "response.created") {
            responseActiveRef.current = true;
            cancelledResponseRef.current = false;
            assistantTranscriptEmittedRef.current = false;
            setIsGenerating(true);
          } else if (
            type === "response.audio.delta" ||
            type === "response.output_audio.delta"
          ) {
            responseActiveRef.current = true;
            isSpeakingRef.current = true;
            setIsAssistantSpeaking(true);
            setIsGenerating(true);
          } else if (
            type === "response.output_audio_transcript.delta" ||
            type === "response.audio_transcript.delta"
          ) {
            if (typeof evt.delta === "string") {
              assistantTranscriptBufRef.current += evt.delta;
            }
          } else if (
            type === "response.output_audio_transcript.done" ||
            type === "response.audio_transcript.done"
          ) {
            flushAssistantTranscript(
              typeof evt.transcript === "string" ? evt.transcript : undefined,
            );
          } else if (
            type === "conversation.item.input_audio_transcription.completed"
          ) {
            const text =
              typeof evt.transcript === "string" ? evt.transcript.trim() : "";
            if (text) {
              onUserTranscriptRef.current?.(text);
            }
          } else if (type === "response.function_call_arguments.done") {
            if (
              typeof evt.call_id === "string" &&
              typeof evt.name === "string" &&
              typeof evt.arguments === "string"
            ) {
              void fulfillFunctionCall({
                call_id: evt.call_id,
                name: evt.name,
                arguments: evt.arguments,
              });
            }
          } else if (type === "response.cancelled") {
            cancelledResponseRef.current = true;
            pendingToolCallRef.current = false;
            assistantTranscriptBufRef.current = "";
            assistantTranscriptEmittedRef.current = true;
            markResponseEnded();
          } else if (
            type === "response.done" ||
            type === "response.audio.done" ||
            type === "response.output_audio.done"
          ) {
            if (type === "response.done") {
              const functionCalls = extractFunctionCallsFromDone(evt);
              if (functionCalls.length > 0) {
                for (const call of functionCalls) {
                  void fulfillFunctionCall({
                    call_id: call.call_id!,
                    name: call.name!,
                    arguments:
                      typeof call.arguments === "string" ? call.arguments : "{}",
                  });
                }
                // Keep generating state while tools run; follow-up response.create continues.
                return;
              }
              flushAssistantTranscript();
              if (!pendingToolCallRef.current) {
                markResponseEnded();
              }
            } else {
              isSpeakingRef.current = false;
              setIsAssistantSpeaking(false);
            }
          } else if (type === "error") {
            console.error("Realtime API error:", evt);
            const body = JSON.stringify(evt);
            if (detectOpenAiQuotaError(undefined, body)) {
              if (pcRef.current === pc) {
                disconnect();
                setLastError(body);
                setErrorKind("quota");
                setStatus("error");
              }
            }
          } else if (type === "session.created" || type === "session.updated") {
            console.debug("Realtime session event:", type);
          }
        } catch {
          /* ignore malformed events */
        }
      });

      pc.addEventListener("connectionstatechange", () => {
        const s = pc.connectionState;
        if (s === "failed" || s === "disconnected" || s === "closed") {
          if (pcRef.current === pc) {
            disconnect();
          }
        }
      });

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
        const isQuota = detectOpenAiQuotaError(sdpResp.status, text);
        setErrorKind(isQuota ? "quota" : "generic");
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
      setErrorKind((kind) => kind ?? "generic");
      setStatus("error");
    }
  }, [
    status,
    disconnect,
    markResponseEnded,
    flushAssistantTranscript,
    fulfillFunctionCall,
  ]);

  const commentOnMove = useCallback(
    (ctx: CoachEvent) => {
      const dc = dcRef.current;
      if (!beginNewResponse()) return;
      dc!.send(
        JSON.stringify({
          type: "response.create",
          response: {
            output_modalities: ["audio"],
            instructions: buildCoachInstructions(ctx, userNameRef.current),
          },
        }),
      );
    },
    [beginNewResponse],
  );

  const speakIntro = useCallback(
    ({ instructions, gameLog }: RealtimeIntroContext) => {
      const dc = dcRef.current;
      if (!beginNewResponse()) return;

      const studentLabel = userNameRef.current ?? "student";
      const transcriptBlock =
        gameLog && gameLog.length > 0
          ? `\n\n# Authoritative Source — Game Transcript\n(${studentLabel} = White, coach = Black)\n\n${formatGameTranscript(gameLog)}`
          : "";

      dc!.send(
        JSON.stringify({
          type: "response.create",
          response: {
            output_modalities: ["audio"],
            instructions: `# Task\n${instructions}${transcriptBlock}`,
          },
        }),
      );
    },
    [beginNewResponse],
  );

  const setMicMuted = useCallback((muted: boolean) => {
    const stream = micStreamRef.current;
    if (stream) {
      stream.getAudioTracks().forEach((t) => {
        t.enabled = !muted;
      });
    }
    setMicMutedState(muted);
  }, []);

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
    isGenerating,
    lastError,
    errorKind,
    connect,
    disconnect,
    commentOnMove,
    speakIntro,
    interruptAssistant,
    setMicMuted,
  };
}
