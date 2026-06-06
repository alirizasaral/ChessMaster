import { useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import { Chess, Square } from "chess.js";
import { Chessboard } from "react-chessboard";
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
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { pickEngineMoveSan, describeGameOver } from "@/lib/engine";
import { useRealtimeCoach } from "@/lib/use-realtime";

const STORE_KEY = "chess-trainer:free-play";
const DEFAULT_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

interface ChatMessage {
  role: "user" | "coach";
  content: string;
}

interface FreePlayState {
  fen: string;
  moves: string[];
  chat: ChatMessage[];
}

function loadState(): FreePlayState {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) return JSON.parse(raw) as FreePlayState;
  } catch {
    /* noop */
  }
  return {
    fen: DEFAULT_FEN,
    moves: [],
    chat: [
      {
        role: "coach",
        content:
          "Free play mode. You play White, I play Black. Make any move you like — I'll give you a quick read on it as we go.",
      },
    ],
  };
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
  const [state, setState] = useState<FreePlayState>(() => loadState());
  const [game, setGame] = useState(() => {
    try {
      return new Chess(state.fen);
    } catch {
      return new Chess();
    }
  });
  const [boardWidth, setBoardWidth] = useState(() =>
    Math.min(window.innerWidth - 48, 360),
  );
  const [selectedSquare, setSelectedSquare] = useState<Square | null>(null);
  const [optionSquares, setOptionSquares] = useState<
    Record<string, React.CSSProperties>
  >({});
  const [isComputerThinking, setIsComputerThinking] = useState(false);

  const pendingReplyRef = useRef<number | null>(null);

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
  } = useRealtimeCoach();

  // Persist on every state change.
  useEffect(() => {
    saveState(state);
  }, [state]);

  // Responsive board
  useEffect(() => {
    const onResize = () =>
      setBoardWidth(Math.min(window.innerWidth - 48, 360));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
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
  const introSnapshotRef = useRef<{ moves: string[]; turn: "w" | "b" }>({
    moves: [],
    turn: "w",
  });
  useEffect(() => {
    introSnapshotRef.current = { moves: state.moves, turn: game.turn() };
  }, [state.moves, game]);

  useEffect(() => {
    if (!voiceReady) return;
    const snap = introSnapshotRef.current;
    if (snap.moves.length === 0) {
      speakIntro(
        `Free play game starting. The student plays WHITE, you play BLACK. ` +
        `Greet them and tell them to make any opening move they like. One short sentence.`,
      );
    } else {
      const turn = snap.turn === "w" ? "the student's (White)" : "your (Black)";
      speakIntro(
        `Free play game in progress. The student plays WHITE, you play BLACK. ` +
        `Moves played so far: ${snap.moves.join(" ")}. It's ${turn} turn. ` +
        `Welcome the student back in one short sentence.`,
      );
    }
  }, [voiceReady, speakIntro]);

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

    setGame(copy);
    clearSelection();

    // If user's move ended the game.
    if (copy.isGameOver()) {
      const end = describeGameOver(copy, "free play");
      setState((s) => ({
        fen: afterUserFen,
        moves: movesAfterUser,
        chat: [
          ...s.chat,
          { role: "user", content: `Played ${userSan}` },
          { role: "coach", content: end },
        ],
      }));
      commentOnMove(
        `Free play. Student (White) just played ${userSan} and the game is over. ` +
        `${end} Give one short reaction.`,
      );
      return true;
    }

    // Show user's move, then schedule engine reply.
    setState((s) => ({
      fen: afterUserFen,
      moves: movesAfterUser,
      chat: [...s.chat, { role: "user", content: `Played ${userSan}` }],
    }));
    setIsComputerThinking(true);

    // Live coach feedback on the student's move — fired immediately so the
    // coach reacts while the engine "thinks". Tells the coach plainly: this
    // is free play, student plays White, give an insightful one-sentence read.
    commentOnMove(
      `Free play (no lesson script). The student plays WHITE and just played ${userSan} (move ${movesAfterUser.length}). ` +
      `You play BLACK and are about to reply. Give ONE short, insightful read on the student's move — ` +
      `is it good, dubious, what does it do, what should they watch for. Stay in character.`,
    );

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
      setState((s) => ({
        fen: finalFen,
        moves: finalMoves,
        chat: [...s.chat, { role: "coach", content: coachMsg }],
      }));
      commentOnMove(
        `Free play. The student (White) played ${userSan}. ` +
        (engineSan
          ? `You (Black) just replied with ${engineSan}. `
          : `You have no legal reply. `) +
        (after.isGameOver()
          ? `Game over: ${describeGameOver(after, "free play")} `
          : `It's the student's turn now. `) +
        `Give ONE short, witty comment about your own move (no recap of theirs).`,
      );
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

    const undone = state.moves.slice(newMoves.length);

    setGame(rebuilt);
    clearSelection();
    setState((s) => {
      const newChat = [...s.chat];
      if (newChat.length >= 1 && newChat[newChat.length - 1].role === "coach") newChat.pop();
      if (newChat.length >= 1 && newChat[newChat.length - 1].role === "user") newChat.pop();
      return { fen: rebuilt.fen(), moves: newMoves, chat: newChat };
    });

    if (undone.length > 0) {
      const desc =
        undone.length === 2
          ? `your reply ${undone[1]} and the student's move ${undone[0]}`
          : `the student's move ${undone[0]}`;
      commentOnMove(
        `Free play. The student tapped undo and took back ${desc}. Give ONE short reaction.`,
      );
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
    setState({
      fen: fresh.fen(),
      moves: [],
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
      speakIntro(
        `The student just reset the free-play board to the starting position. ` +
        `Make one short remark about starting fresh.`,
      );
    }
  };

  return (
    <div className="min-h-[100dvh] flex flex-col bg-background">
      <header className="flex items-center justify-between p-4 border-b border-border bg-card shadow-sm z-10">
        <div className="flex items-center gap-3">
          <Link href="/">
            <Button
              variant="ghost"
              size="icon"
              className="shrink-0 text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="w-5 h-5" />
            </Button>
          </Link>
          <div>
            <h1 className="font-serif font-medium text-lg leading-none">Free Play</h1>
            <p className="text-xs text-muted-foreground mt-1">
              {game.turn() === "w" ? "Your move" : "Coach is thinking…"}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1">
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
        </div>
      </header>

      <div className="flex-none bg-muted/30 border-b border-border p-4 flex justify-center">
        <div
          className="rounded-sm overflow-hidden shadow-md"
          style={{ width: boardWidth, flexShrink: 0 }}
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

      {/* Chat Area — newest message at top */}
      <div className="flex-1 overflow-hidden flex flex-col bg-card">
        <div className="flex-1 overflow-y-auto p-4 space-y-4 flex flex-col">
          {isComputerThinking && (
            <div className="flex max-w-[85%] mr-auto items-start">
              <div className="px-4 py-3 rounded-2xl bg-muted text-muted-foreground border border-border rounded-tl-sm flex items-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Coach is replying...</span>
              </div>
            </div>
          )}
          {[...state.chat].reverse().map((msg, i) => (
            <div
              key={i}
              className={`flex flex-col max-w-[85%] ${
                msg.role === "user" ? "ml-auto items-end" : "mr-auto items-start"
              }`}
            >
              <div
                className={`px-4 py-3 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap ${
                  msg.role === "user"
                    ? "bg-primary text-primary-foreground rounded-tr-sm"
                    : "bg-muted text-foreground border border-border rounded-tl-sm"
                }`}
              >
                {msg.content}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
