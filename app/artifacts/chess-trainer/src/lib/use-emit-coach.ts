import { useCallback, useState } from "react";
import type { CoachEvent } from "@/lib/coach-prompts";
import { requestCoachFeedback } from "@/lib/request-coach-feedback";

/**
 * Dispatch a coach event to Realtime (voice on) or Completions (voice off).
 * Never fans out to both.
 */
export function useEmitCoach({
  voiceConnected,
  commentOnMove,
  userName,
  onCoachText,
  onError,
}: {
  voiceConnected: boolean;
  commentOnMove: (event: CoachEvent) => void;
  userName?: string;
  onCoachText: (text: string) => void;
  onError?: (message: string) => void;
}) {
  const [isTextPending, setIsTextPending] = useState(false);

  const emitCoach = useCallback(
    (event: CoachEvent) => {
      if (voiceConnected) {
        commentOnMove(event);
        return;
      }
      setIsTextPending(true);
      void requestCoachFeedback(event, userName)
        .then((text) => {
          onCoachText(text);
        })
        .catch((err: unknown) => {
          const message =
            err instanceof Error ? err.message : "Could not get coach feedback.";
          onError?.(message);
        })
        .finally(() => {
          setIsTextPending(false);
        });
    },
    [voiceConnected, commentOnMove, userName, onCoachText, onError],
  );

  return { emitCoach, isTextPending };
}
