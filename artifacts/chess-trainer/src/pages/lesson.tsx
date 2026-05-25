import { useState, useEffect, useRef, useCallback } from "react";
import { useParams, Link } from "wouter";
import { Chess, Square } from "chess.js";
import { Chessboard } from "react-chessboard";
import { useStore } from "@/hooks/use-store";
import { useGetCoachFeedback } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Undo2, Check, Volume2, VolumeX, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

type ChatMessage = { role: "user" | "coach"; content: string; moveNumber?: number };

const FIRST_MOVE_HINTS: Record<string, { square: Square; move: string; tip: string }> = {
  "italian-game":     { square: "e2", move: "1. e4", tip: "Push the e-pawn two squares to control the center." },
  "ruy-lopez":        { square: "e2", move: "1. e4", tip: "Open with e4 — the classic starting move for the Ruy Lopez." },
  "queens-gambit":    { square: "d2", move: "1. d4", tip: "Push the d-pawn to claim central space for the Queen's Gambit." },
  "london-system":    { square: "d2", move: "1. d4", tip: "Start with d4 to build the solid London pawn structure." },
  "sicilian-defense": { square: "e2", move: "1. e4", tip: "Open with e4 to invite the Sicilian — the sharpest reply." },
  "caro-kann":        { square: "e2", move: "1. e4", tip: "Play e4 to prompt Black's solid Caro-Kann setup." },
};

export default function Lesson() {
  const { lessonId } = useParams();
  const { state, updateLesson, toggleSound } = useStore();
  const { toast } = useToast();

  const lesson = lessonId ? state.lessons[lessonId] : null;
  const soundEnabled = state.settings.sound;

  const [game, setGame] = useState(new Chess());
  const [boardWidth, setBoardWidth] = useState(() => Math.min(window.innerWidth - 48, 360));
  const [selectedSquare, setSelectedSquare] = useState<Square | null>(null);
  const [optionSquares, setOptionSquares] = useState<Record<string, React.CSSProperties>>({});

  const containerRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const coachMutation = useGetCoachFeedback();

  const playAudio = useCallback(async (text: string) => {
    if (!soundEnabled) return;
    try {
      const BASE_URL = import.meta.env.BASE_URL;
      const response = await fetch(`${BASE_URL}api/tts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      if (!response.ok) throw new Error("TTS failed");
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audio.play();
    } catch (e) {
      console.error("Audio error:", e);
    }
  }, [soundEnabled]);

  // Init game from saved FEN
  useEffect(() => {
    if (lesson?.fen) {
      try {
        const newGame = new Chess(lesson.fen);
        setGame(newGame);
      } catch (e) {
        console.error("Invalid FEN", e);
      }
    }
  // Only run on mount / lessonId change, not every FEN update
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lessonId]);

  // Responsive board width — cap at 360px so chat is always visible
  useEffect(() => {
    const handleResize = () => {
      setBoardWidth(Math.min(window.innerWidth - 48, 360));
    };
    window.addEventListener("resize", handleResize);
    handleResize();
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  // Scroll chat to bottom
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [lesson?.chat]);

  if (!lesson || !lessonId) {
    return <div className="p-8 text-center text-muted-foreground">Lesson not found.</div>;
  }

  // Build highlight styles for legal move targets
  const getMoveOptions = (square: Square) => {
    const moves = game.moves({ square, verbose: true });
    if (moves.length === 0) return {};

    const squares: Record<string, React.CSSProperties> = {};

    // Highlight selected square
    squares[square] = {
      background: "rgba(var(--color-primary-rgb, 89 125 80), 0.35)",
      borderRadius: "4px",
    };

    // Highlight legal targets
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

  const clearSelection = () => {
    setSelectedSquare(null);
    setOptionSquares({});
  };

  const executeMove = (from: Square, to: Square) => {
    if (coachMutation.isPending) return false;

    const gameCopy = new Chess(game.fen());
    let result;
    try {
      result = gameCopy.move({ from, to, promotion: "q" });
    } catch {
      result = null;
    }

    if (!result) return false;

    setGame(gameCopy);
    clearSelection();

    const newFen = gameCopy.fen();
    const moveHistory = gameCopy.history();
    const lastMove = result.san;

    updateLesson(lessonId, (l) => ({
      ...l,
      fen: newFen,
      moves: moveHistory,
      status: l.status === "not_started" ? "started" : l.status,
      chat: [
        ...l.chat,
        { role: "user" as const, content: `Played ${lastMove}`, moveNumber: moveHistory.length },
      ],
    }));

    coachMutation.mutate(
      { data: { lessonId, lessonName: lesson.name, fen: newFen, moves: moveHistory, lastMove } },
      {
        onSuccess: (res) => {
          updateLesson(lessonId, (l) => ({
            ...l,
            chat: [...l.chat, { role: "coach" as const, content: res.feedback }],
          }));
          playAudio(res.feedback);
        },
        onError: () => {
          toast({ title: "Couldn't get coaching feedback", variant: "destructive" });
        },
      }
    );

    return true;
  };

  // Click interaction
  const handleSquareClick = (square: Square) => {
    if (coachMutation.isPending) return;

    const piece = game.get(square);

    // Nothing selected yet — select if it's the current player's piece
    if (!selectedSquare) {
      if (piece && piece.color === game.turn()) {
        setSelectedSquare(square);
        setOptionSquares(getMoveOptions(square));
      }
      return;
    }

    // Clicking the same square → deselect
    if (square === selectedSquare) {
      clearSelection();
      return;
    }

    // Clicking another own piece → reselect
    if (piece && piece.color === game.turn()) {
      setSelectedSquare(square);
      setOptionSquares(getMoveOptions(square));
      return;
    }

    // Attempt the move
    const moved = executeMove(selectedSquare, square);
    if (!moved) {
      // Not a legal target — deselect
      clearSelection();
    }
  };

  // Drag-and-drop still works too
  const handlePieceDrop = (sourceSquare: string, targetSquare: string) => {
    clearSelection();
    return executeMove(sourceSquare as Square, targetSquare as Square);
  };

  const handleUndo = () => {
    const gameCopy = new Chess(game.fen());
    const result = gameCopy.undo();
    if (!result) return;

    setGame(gameCopy);
    clearSelection();

    updateLesson(lessonId, (l) => {
      const newChat = [...l.chat];
      // Remove last coach + user pair
      if (newChat.length >= 1 && newChat[newChat.length - 1].role === "coach") newChat.pop();
      if (newChat.length >= 1 && newChat[newChat.length - 1].role === "user") newChat.pop();
      return { ...l, fen: gameCopy.fen(), moves: gameCopy.history(), chat: newChat };
    });
  };

  const handleFinish = () => {
    updateLesson(lessonId, (l) => ({ ...l, status: "finished" }));
    toast({ title: "Lesson marked as finished!" });
  };

  const isFirstLesson = lesson.moves.length === 0;
  const firstMoveHint = lessonId ? FIRST_MOVE_HINTS[lessonId] : undefined;

  // When no piece is selected on a fresh board, gently pulse the suggested first-move square
  const boardSquareStyles = isFirstLesson && !selectedSquare && firstMoveHint
    ? {
        ...optionSquares,
        [firstMoveHint.square]: {
          background: "rgba(var(--color-primary-rgb, 89 125 80), 0.25)",
          borderRadius: "4px",
          boxShadow: "inset 0 0 0 2px hsl(var(--primary))",
        },
      }
    : optionSquares;

  return (
    <div className="min-h-[100dvh] flex flex-col bg-background">
      {/* Top Bar */}
      <header className="flex items-center justify-between p-4 border-b border-border bg-card shadow-sm z-10">
        <div className="flex items-center gap-3">
          <Link href="/">
            <Button variant="ghost" size="icon" className="shrink-0 text-muted-foreground hover:text-foreground">
              <ArrowLeft className="w-5 h-5" />
            </Button>
          </Link>
          <div>
            <h1 className="font-serif font-medium text-lg leading-none">{lesson.name}</h1>
            <p className="text-xs text-muted-foreground mt-1 capitalize">{lesson.status.replace("_", " ")}</p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            onClick={toggleSound}
            className="text-muted-foreground"
            title={soundEnabled ? "Mute" : "Unmute"}
            data-testid="button-mute"
          >
            {soundEnabled ? <Volume2 className="w-5 h-5" /> : <VolumeX className="w-5 h-5" />}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={handleUndo}
            disabled={lesson.moves.length === 0}
            className="text-muted-foreground"
            data-testid="button-undo"
          >
            <Undo2 className="w-5 h-5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={handleFinish}
            className="text-primary hover:text-primary/80 hover:bg-primary/10"
            data-testid="button-finish"
          >
            <Check className="w-5 h-5" />
          </Button>
        </div>
      </header>

      {/* Board */}
      <div
        className="flex-none bg-muted/30 border-b border-border p-4 flex justify-center"
        ref={containerRef}
      >
        <div
          className="rounded-sm overflow-hidden shadow-md"
          style={{ width: boardWidth, height: boardWidth, flexShrink: 0 }}
        >
          <Chessboard
            position={game.fen()}
            onPieceDrop={handlePieceDrop}
            onSquareClick={handleSquareClick}
            boardWidth={boardWidth}
            customSquareStyles={boardSquareStyles}
            customDarkSquareStyle={{ backgroundColor: "hsl(var(--primary))" }}
            customLightSquareStyle={{ backgroundColor: "hsl(var(--secondary))" }}
            animationDuration={150}
          />
        </div>
      </div>

      {/* Chat Area */}
      <div className="flex-1 overflow-hidden flex flex-col bg-card">
        <div className="flex-1 overflow-y-auto p-4 space-y-4" ref={scrollRef}>

          {/* First-time instructions */}
          {isFirstLesson && (
            <div className="rounded-xl border border-border bg-muted/60 p-4 text-sm text-foreground space-y-3">
              {firstMoveHint && (
                <div className="flex items-start gap-3 rounded-lg bg-primary/10 border border-primary/20 px-3 py-2">
                  <span className="font-mono font-bold text-primary text-base leading-tight shrink-0">{firstMoveHint.move}</span>
                  <span className="text-muted-foreground leading-snug">{firstMoveHint.tip}</span>
                </div>
              )}
              <div>
                <p className="font-medium mb-1">How to play</p>
                <ul className="space-y-1 text-muted-foreground list-disc list-inside">
                  <li>Tap the highlighted square to make your first move</li>
                  <li>Tap a piece to see all legal moves as dots</li>
                  <li>Tap a highlighted square to move there</li>
                  <li>Drag and drop also works</li>
                </ul>
              </div>
            </div>
          )}

          {/* Chat messages */}
          {(lesson.chat as ChatMessage[]).map((msg, i) => (
            <div
              key={i}
              className={`flex flex-col max-w-[85%] ${msg.role === "user" ? "ml-auto items-end" : "mr-auto items-start"}`}
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

          {coachMutation.isPending && (
            <div className="flex max-w-[85%] mr-auto items-start">
              <div className="px-4 py-3 rounded-2xl bg-muted text-muted-foreground border border-border rounded-tl-sm flex items-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Coach is thinking...</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
