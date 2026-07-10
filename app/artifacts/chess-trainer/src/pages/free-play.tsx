import { useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import { Chess, Square } from "chess.js";
import { Chessboard } from "react-chessboard";
import { useStore } from "@/hooks/use-store";
import { Button } from "@/components/ui/button";
import {
  ArrowLeft,
  Undo2,
  Loader2,
  Mic,
  MicOff,
  PhoneCall,
  PhoneOff,
  RotateCcw,
  Settings,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { pickEngineMoveSan, describeGameOver } from "@/lib/engine";
import {
  appendCoachPlay,
  appendReset,
  appendRollback,
  appendStudentPlay,
  removedPliesFromUndoneMoves,
  resolveGameLog,
  type GameEvent,
} from "@/lib/game-transcript";
import { useRealtimeCoach } from "@/lib/use-realtime";
import { computeBoardSize, DESKTOP_BREAKPOINT } from "@/lib/board-layout";

const STORE_KEY = "chess-trainer:free-play";
const DEFAULT_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

interface ChatMessage {
  role: "user" | "coach";
  content: string;
}

interface FreePlayState {
  fen: string;
  moves: string[];
  gameLog: GameEvent[];
  chat: ChatMessage[];
}

function normalizeFreePlayState(raw: Partial<FreePlayState>): FreePlayState {
  const moves = raw.moves ?? [];
  return {
    fen: raw.fen ?? DEFAULT_FEN,
    moves,
    gameLog: resolveGameLog(moves, raw.gameLog),
    chat: raw.chat ?? [
      {
        role: "coach",
        content:
          "Free play mode. You play White, I play Black. Make any move you like — I'll give you a quick read on it as we go.",
      },
    ],
  };
}

function loadState(): FreePlayState {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) return normalizeFreePlayState(JSON.parse(raw) as Partial<FreePlayState>);
  } catch {
    /* noop */
  }
  return normalizeFreePlayState({});
}

function saveState(s: FreePlayState) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(s));
  } catch {
    /* noop */
  }
}

export default function FreePlay() {
  const { toast } = useToast();
  const { state: appState } = useStore();
  const userName = appState.settings.userName;
  const [state, setState] = useState<FreePlayState>(() => loadState());
  const [game, setGame] = useState(() => {
    try {
      return new Chess(state.fen);
    } catch {
      return new Chess();
    }
  });
  const [boardWidth, setBoardWidth] = useState(() =>
    computeBoardSize(window.innerWidth, window.innerWidth >= DESKTOP_BREAKPOINT),
  );
  const [selectedSquare, setSelectedSquare] = useState<Square | null>(null);
  const [optionSquares, setOptionSquares] = useState<
    Record<string, React.CSSProperties>
  >({});
  const [isComputerThinking, setIsComputerThinking] = useState(false);

  const pendingReplyRef = useRef<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const {
    status: voiceStatus,
    isReady: voiceReady,
    isMicMuted,
    isAssistantSpeaking,
    lastError: voiceError,
    connect: connectVoice,
    disconnect: disconnectVoice,
    commentOnMove,
    speakIntro,
    interruptAssistant,
    setMicMuted,
  } = useRealtimeCoach({ userName });

  // Persist on every state change.
  useEffect(() => {
    saveState(state);
  }, [state]);

  // Container-aware board sizing so the board scales with its column, not the viewport alone.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const updateSize = () => {
      const isDesktop = window.matchMedia(`(min-width: ${DESKTOP_BREAKPOINT}px)`).matches;
      setBoardWidth(computeBoardSize(container.getBoundingClientRect().width, isDesktop));
    };

    const observer = new ResizeObserver(updateSize);
    observer.observe(container);
    window.addEventListener("resize", updateSize);
    updateSize();

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", updateSize);
    };
  }, []);


  // Voice error toast
  useEffect(() => {
    if (voiceStatus === "error") {
      toast({
        title: "Couldn't start the voice coach",
        description: voiceError ?? "Check your microphone permission and try again.",
        variant: "destructive",
      });
    }
  }, [voiceStatus, voiceError, toast]);

  // Voice intro — fires once on each false->true voiceReady transition,
  // using a snapshot of game state at that moment. Keyed only on
  // `voiceReady` so move updates don't re-fire it (which would otherwise
  // cancel in-flight per-move commentary via speakIntro's interrupt).
  const introSnapshotRef = useRef<{ gameLog: GameEvent[]; turn: "w" | "b" }>({
    gameLog: [],
    turn: "w",
  });
  useEffect(() => {
    introSnapshotRef.current = {
      gameLog: resolveGameLog(state.moves, state.gameLog),
      turn: game.turn(),
    };
  }, [state.moves, state.gameLog, game]);

  useEffect(() => {
    if (!voiceReady) return;
    const snap = introSnapshotRef.current;
    const hasPlays = snap.gameLog.some((e) => e.type === "play");

    const who = userName ?? "the student";

    if (!hasPlays) {
      speakIntro({
        instructions:
          `Free play game starting. ${who} plays WHITE, you play BLACK. ` +
          `Greet them and tell them to make any opening move they like.`,
        gameLog: snap.gameLog,
      });
    } else {
      const turn = snap.turn === "w" ? `${who}'s (White)` : "your (Black)";
      speakIntro({
        instructions:
          `Free play game in progress. ${who} plays WHITE, you play BLACK. ` +
          `It's ${turn} turn. Welcome ${who} back.`,
        gameLog: snap.gameLog,
      });
    }
  }, [voiceReady, speakIntro, userName]);

  // Cleanup pending timeouts on unmount
  useEffect(() => {
    return () => {
      if (pendingReplyRef.current !== null) {
        window.clearTimeout(pendingReplyRef.current);
        pendingReplyRef.current = null;
      }
    };
  }, []);

  const clearSelection = () => {
    setSelectedSquare(null);
    setOptionSquares({});
  };

  const getMoveOptions = (square: Square) => {
    const moves = game.moves({ square, verbose: true });
    if (moves.length === 0) return {};
    const squares: Record<string, React.CSSProperties> = {};
    squares[square] = {
      background: "rgba(var(--color-primary-rgb, 89 125 80), 0.35)",
      borderRadius: "4px",
    };
    moves.forEach((move) => {
      const isCapture = game.get(move.to as Square);
      squares[move.to] = isCapture
        ? {
            background:
              "radial-gradient(circle, rgba(var(--color-primary-rgb, 89 125 80), 0.5) 55%, transparent 55%)",
            borderRadius: "50%",
          }
        : {
            background:
              "radial-gradient(circle, rgba(0,0,0,0.18) 28%, transparent 28%)",
            borderRadius: "50%",
          };
    });
    return squares;
  };

  const handleToggleVoice = async () => {
    if (voiceStatus === "connected" || voiceStatus === "connecting") {
      disconnectVoice();
      return;
    }
    await connectVoice();
  };

  const executeMove = (from: Square, to: Square): boolean => {
    if (isComputerThinking) return false;
    if (game.turn() !== "w") return false;

    const copy = new Chess(game.fen());
    let res;
    try {
      res = copy.move({ from, to, promotion: "q" });
    } catch {
      res = null;
    }
    if (!res) return false;

    const userSan = res.san;
    const afterUserFen = copy.fen();
    const movesAfterUser = [...state.moves, userSan];
    const gameLogBefore = resolveGameLog(state.moves, state.gameLog);
    const logAfterUser = appendStudentPlay(gameLogBefore, userSan);
    const mode = "Free play";

    setGame(copy);
    clearSelection();

    // If user's move ended the game.
    if (copy.isGameOver()) {
      const end = describeGameOver(copy, "free play");
      setState((s) => ({
        fen: afterUserFen,
        moves: movesAfterUser,
        gameLog: logAfterUser,
        chat: [
          ...s.chat,
          { role: "user", content: `Played ${userSan}` },
          { role: "coach", content: end },
        ],
      }));
      commentOnMove({
        gameLog: logAfterUser,
        trigger: "game_over",
        mode,
        hint: end,
      });
      return true;
    }

    // Show user's move, then schedule engine reply.
    setState((s) => ({
      fen: afterUserFen,
      moves: movesAfterUser,
      gameLog: logAfterUser,
      chat: [...s.chat, { role: "user", content: `Played ${userSan}` }],
    }));
    setIsComputerThinking(true);

    commentOnMove({
      gameLog: logAfterUser,
      trigger: "student_move",
      mode,
      hint:
        "Give ONE short, insightful read on the student's move — is it good, dubious, what does it do, what should they watch for. You are about to reply as Black.",
    });

    if (pendingReplyRef.current !== null) {
      window.clearTimeout(pendingReplyRef.current);
    }

    const scheduledFen = afterUserFen;
    pendingReplyRef.current = window.setTimeout(() => {
      pendingReplyRef.current = null;

      const engineSan = pickEngineMoveSan(scheduledFen, 3);
      const after = new Chess(scheduledFen);
      let finalMoves = movesAfterUser;
      if (engineSan) {
        const applied = after.move(engineSan);
        if (applied) finalMoves = [...movesAfterUser, engineSan];
      }
      const finalFen = after.fen();

      let coachMsg: string;
      if (after.isGameOver()) {
        coachMsg = engineSan
          ? `I played ${engineSan}. ${describeGameOver(after, "free play")}`
          : describeGameOver(after, "free play");
      } else if (engineSan) {
        coachMsg = `I played ${engineSan}. Your move.`;
      } else {
        coachMsg = `I have no legal moves. ${describeGameOver(after, "free play")}`;
      }

      setGame(after);
      setIsComputerThinking(false);
      const logAfterCoach = engineSan
        ? appendCoachPlay(logAfterUser, engineSan)
        : logAfterUser;
      setState((s) => ({
        fen: finalFen,
        moves: finalMoves,
        gameLog: logAfterCoach,
        chat: [...s.chat, { role: "coach", content: coachMsg }],
      }));
      commentOnMove({
        gameLog: logAfterCoach,
        trigger: after.isGameOver() ? "game_over" : "coach_move",
        mode,
        hint: after.isGameOver()
          ? describeGameOver(after, "free play")
          : "Give ONE short, witty comment about your own move (no recap of theirs).",
      });
    }, 600);

    return true;
  };

  const handleSquareClick = ({ square }: { square: string }) => {
    if (isComputerThinking) return;
    if (game.turn() !== "w") return;
    const sq = square as Square;
    const piece = game.get(sq);

    if (!selectedSquare) {
      if (piece && piece.color === "w") {
        setSelectedSquare(sq);
        setOptionSquares(getMoveOptions(sq));
      }
      return;
    }
    if (sq === selectedSquare) {
      clearSelection();
      return;
    }
    if (piece && piece.color === "w") {
      setSelectedSquare(sq);
      setOptionSquares(getMoveOptions(sq));
      return;
    }
    const moved = executeMove(selectedSquare, sq);
    if (!moved) clearSelection();
  };

  const handlePieceDrop = ({
    sourceSquare,
    targetSquare,
  }: {
    sourceSquare: string;
    targetSquare: string | null;
  }) => {
    clearSelection();
    if (!targetSquare) return false;
    if (isComputerThinking) return false;
    if (game.turn() !== "w") return false;
    return executeMove(sourceSquare as Square, targetSquare as Square);
  };

  const handleUndo = () => {
    if (isComputerThinking) return;
    if (state.moves.length === 0) return;

    const newMoves = [...state.moves];
    // Replay to find whose turn — if Black just moved, pop both; else just the last.
    const replay = new Chess();
    newMoves.forEach((m) => replay.move(m));
    if (replay.turn() === "w") {
      newMoves.pop();
      newMoves.pop();
    } else {
      newMoves.pop();
    }
    const rebuilt = new Chess();
    newMoves.forEach((m) => rebuilt.move(m));

    const gameLogBefore = resolveGameLog(state.moves, state.gameLog);
    const removed = removedPliesFromUndoneMoves(state.moves, newMoves.length);
    const logAfterUndo = appendRollback(gameLogBefore, removed);

    setGame(rebuilt);
    clearSelection();
    setState((s) => {
      const newChat = [...s.chat];
      if (newChat.length >= 1 && newChat[newChat.length - 1].role === "coach") newChat.pop();
      if (newChat.length >= 1 && newChat[newChat.length - 1].role === "user") newChat.pop();
      return { fen: rebuilt.fen(), moves: newMoves, gameLog: logAfterUndo, chat: newChat };
    });

    if (removed.length > 0) {
      commentOnMove({
        gameLog: logAfterUndo,
        trigger: "undo",
        mode: "Free play",
      });
    }
  };

  const handleReset = () => {
    const ok = window.confirm(
      "Reset the free-play game? The board and chat will start over.",
    );
    if (!ok) return;

    if (pendingReplyRef.current !== null) {
      window.clearTimeout(pendingReplyRef.current);
      pendingReplyRef.current = null;
    }
    setIsComputerThinking(false);
    clearSelection();
    const fresh = new Chess();
    setGame(fresh);

    const logWithReset = appendReset(resolveGameLog(state.moves, state.gameLog));

    setState({
      fen: fresh.fen(),
      moves: [],
      gameLog: [],
      chat: [
        {
          role: "coach",
          content:
            "Fresh board. You're White, I'm Black. Make any move you like.",
        },
      ],
    });

    interruptAssistant();
    if (voiceReady) {
      const who = userName ?? "the student";
      speakIntro({
        instructions:
          `${who} just reset the free-play board to the starting position. ` +
          `Make one short remark about starting fresh.`,
        gameLog: logWithReset,
      });
    }
  };

  return (
    <div className="min-h-[100dvh] flex flex-col bg-background pb-[env(safe-area-inset-bottom)]">
      <header className="flex items-center justify-between gap-2 px-3 py-3 sm:px-4 sm:py-4 pt-[max(0.75rem,env(safe-area-inset-top))] border-b border-border bg-card shadow-sm z-10 shrink-0">
        <div className="flex items-center gap-2 sm:gap-3 min-w-0">
          <Link href="/">
            <Button
              variant="ghost"
              size="icon"
              className="shrink-0 text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="w-5 h-5" />
            </Button>
          </Link>
          <div className="min-w-0">
            <h1 className="font-serif font-medium text-base sm:text-lg leading-none truncate">Free Play</h1>
            <p className="text-xs text-muted-foreground mt-1 truncate">
              {game.turn() === "w" ? "Your move" : "Coach is thinking…"}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-0.5 sm:gap-1 shrink-0">
          <Button
            variant="ghost"
            size="icon"
            onClick={handleToggleVoice}
            className={
              voiceStatus === "connected"
                ? isAssistantSpeaking
                  ? "text-primary animate-pulse"
                  : "text-primary"
                : "text-muted-foreground"
            }
            title={
              voiceStatus === "connected"
                ? "End voice coach"
                : voiceStatus === "connecting"
                ? "Connecting…"
                : "Start voice coach"
            }
            disabled={voiceStatus === "connecting"}
            data-testid="button-voice"
          >
            {voiceStatus === "connecting" ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : voiceStatus === "connected" ? (
              <PhoneOff className="w-5 h-5" />
            ) : (
              <PhoneCall className="w-5 h-5" />
            )}
          </Button>
          {voiceStatus === "connected" && (
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setMicMuted(!isMicMuted)}
              className={isMicMuted ? "text-muted-foreground" : "text-primary"}
              title={isMicMuted ? "Unmute microphone" : "Mute microphone"}
              data-testid="button-mic"
            >
              {isMicMuted ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            onClick={handleUndo}
            disabled={state.moves.length === 0}
            className="text-muted-foreground"
            data-testid="button-undo"
          >
            <Undo2 className="w-5 h-5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={handleReset}
            disabled={state.moves.length === 0}
            className="text-muted-foreground hover:text-destructive"
            title="Reset board"
            data-testid="button-reset"
          >
            <RotateCcw className="w-5 h-5" />
          </Button>
          <Link href="/settings">
            <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-foreground" title="Settings">
              <Settings className="w-5 h-5" />
            </Button>
          </Link>
        </div>
      </header>

      <main className="flex-1 min-h-0 flex flex-col lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(320px,420px)] lg:max-w-6xl lg:mx-auto lg:w-full lg:gap-6 lg:px-6 lg:py-4">
        <div
          className="flex-none lg:flex lg:items-center lg:justify-center bg-muted/30 border-b lg:border-b-0 lg:border lg:rounded-xl border-border p-3 sm:p-4"
          ref={containerRef}
        >
          <div
            className="mx-auto rounded-sm overflow-hidden shadow-md"
            style={{ width: boardWidth, height: boardWidth, flexShrink: 0 }}
          >
            <Chessboard
              options={{
                position: game.fen(),
                onPieceDrop: handlePieceDrop,
                onSquareClick: handleSquareClick,
                squareStyles: optionSquares,
                darkSquareStyle: { backgroundColor: "hsl(var(--primary))" },
                lightSquareStyle: { backgroundColor: "hsl(var(--secondary))" },
                animationDurationInMs: 150,
              }}
            />
          </div>
        </div>

        <div className="flex-1 min-h-0 overflow-hidden flex flex-col bg-card lg:rounded-xl lg:border lg:border-border lg:shadow-sm lg:max-h-[calc(100dvh-6.5rem)]">
          <div className="hidden lg:flex shrink-0 items-center px-4 py-3 border-b border-border">
            <h2 className="font-serif font-medium text-base">Coach</h2>
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto p-3 sm:p-4 space-y-3 sm:space-y-4 flex flex-col">
            {isComputerThinking && (
              <div className="flex max-w-[92%] sm:max-w-[85%] mr-auto items-start">
                <div className="px-3 sm:px-4 py-2.5 sm:py-3 rounded-2xl bg-muted text-muted-foreground border border-border rounded-tl-sm flex items-center gap-2 text-sm">
                  <Loader2 className="w-4 h-4 animate-spin shrink-0" />
                  <span>Coach is replying...</span>
                </div>
              </div>
            )}
            {[...state.chat].reverse().map((msg, i) => (
              <div
                key={i}
                className={`flex flex-col max-w-[92%] sm:max-w-[85%] ${
                  msg.role === "user" ? "ml-auto items-end" : "mr-auto items-start"
                }`}
              >
                <div
                  className={`px-3 sm:px-4 py-2.5 sm:py-3 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap ${
                    msg.role === "user"
                      ? "bg-primary text-primary-foreground rounded-tr-sm"
                      : "bg-muted text-foreground border border-border rounded-tl-sm max-w-prose"
                  }`}
                >
                  {msg.content}
                </div>
              </div>
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}
