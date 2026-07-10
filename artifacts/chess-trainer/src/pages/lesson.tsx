import { useState, useEffect, useRef } from "react";
import { useParams, Link } from "wouter";
import { Chess, Square } from "chess.js";
import { Chessboard } from "react-chessboard";
import { useStore } from "@/hooks/use-store";
import { Button } from "@/components/ui/button";
import {
  ArrowLeft,
  Undo2,
  Check,
  Loader2,
  Mic,
  MicOff,
  PhoneCall,
  PhoneOff,
  RotateCcw,
  Settings,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { checkOpeningMove, OPENINGS } from "@/lib/openings";
import { pickEngineMoveSan, describeGameOver } from "@/lib/engine";
import {
  appendCoachPlay,
  appendReset,
  appendRollback,
  appendStudentPlay,
  removedPliesFromUndoneMoves,
  resolveGameLog,
} from "@/lib/game-transcript";
import { useRealtimeCoach } from "@/lib/use-realtime";

type ChatMessage = { role: "user" | "coach"; content: string; moveNumber?: number };

// Convert a SAN string into the from/to squares for the current position, so we can auto-play it.
function sanToMove(fen: string, san: string): { from: Square; to: Square; promotion?: string } | null {
  const g = new Chess(fen);
  try {
    const m = g.move(san);
    if (!m) return null;
    return { from: m.from as Square, to: m.to as Square, promotion: m.promotion };
  } catch {
    return null;
  }
}

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
  const { state, updateLesson, resetLesson } = useStore();
  const { toast } = useToast();

  const lesson = lessonId ? state.lessons[lessonId] : null;
  const userName = state.settings.userName;

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

  const handleToggleVoice = async () => {
    if (voiceStatus === "connected" || voiceStatus === "connecting") {
      disconnectVoice();
      return;
    }
    await connectVoice();
  };

  // When the voice channel becomes ready (false -> true), deliver a
  // context-aware intro using a SNAPSHOT of the lesson at that moment:
  // greet the student, identify the opening, and tell them the next move
  // they should play according to the recorded mainline. Captured via refs
  // so the effect's only real dependency is `voiceReady` — otherwise it
  // would re-fire (and cancel ongoing move commentary) every move.
  const lessonSnapshotRef = useRef<{
    lessonId: string;
    name: string;
    moves: string[];
    gameLog: ReturnType<typeof resolveGameLog>;
  } | null>(null);
  useEffect(() => {
    lessonSnapshotRef.current = lessonId && lesson
      ? {
          lessonId,
          name: lesson.name,
          moves: lesson.moves,
          gameLog: resolveGameLog(lesson.moves, lesson.gameLog),
        }
      : null;
  }, [lessonId, lesson]);

  useEffect(() => {
    // When voice drops, no-op — intro will re-fire next time it becomes ready.
    if (!voiceReady) return;
    const snap = lessonSnapshotRef.current;
    if (!snap) return;

    const opening = OPENINGS[snap.lessonId];
    const nextUserMove = opening?.line[snap.moves.length] ?? null;

    const who = userName ?? "the student";

    if (snap.moves.length === 0) {
      speakIntro({
        instructions:
          `Greet ${who} for the ${snap.name} lesson. ` +
          `Tell them the very first move they should play is ${opening?.line[0] ?? "the recommended opening move"} ` +
          `(translate into spoken English, e.g. "push your king's pawn two squares" for 1.e4).`,
        gameLog: snap.gameLog,
      });
    } else if (nextUserMove) {
      speakIntro({
        instructions:
          `Lesson in progress: ${snap.name}. ` +
          `Welcome ${who} back and tell them the next move they should play is ${nextUserMove}. ` +
          `Translate it into spoken English.`,
        gameLog: snap.gameLog,
      });
    } else {
      speakIntro({
        instructions:
          `Lesson: ${snap.name}. The recorded mainline is finished. ` +
          `Tell ${who} we're now in free play and to make any move they like.`,
        gameLog: snap.gameLog,
      });
    }
  }, [voiceReady, speakIntro, userName]);

  // Show a toast if connecting fails (status flips to "error" inside the hook).
  // Include the real error message so on-device failures are debuggable.
  useEffect(() => {
    if (voiceStatus === "error") {
      toast({
        title: "Couldn't start the voice coach",
        description: voiceError ?? "Check your microphone permission and try again.",
        variant: "destructive",
      });
    }
  }, [voiceStatus, voiceError, toast]);

  const [game, setGame] = useState(new Chess());
  const [boardWidth, setBoardWidth] = useState(() => Math.min(window.innerWidth - 48, 360));
  const [selectedSquare, setSelectedSquare] = useState<Square | null>(null);
  const [optionSquares, setOptionSquares] = useState<Record<string, React.CSSProperties>>({});
  const [isComputerThinking, setIsComputerThinking] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const pendingReplyRef = useRef<number | null>(null);

  // Cancel any pending auto-reply when the lesson changes or component unmounts.
  // Also reset selection + thinking state so the next lesson session starts clean.
  useEffect(() => {
    return () => {
      if (pendingReplyRef.current !== null) {
        window.clearTimeout(pendingReplyRef.current);
        pendingReplyRef.current = null;
      }
      setIsComputerThinking(false);
      setSelectedSquare(null);
      setOptionSquares({});
    };
  }, [lessonId]);

  // Refresh the intro for not-yet-started lessons so existing users (with older
  // welcome messages in localStorage) also see the new rich opening intro.
  useEffect(() => {
    if (!lessonId || !lesson) return;
    if (lesson.status !== "not_started" || lesson.moves.length > 0) return;
    const opening = OPENINGS[lessonId];
    if (!opening) return;
    const firstMove = opening.line[0];
    const freshIntro = `Welcome to the ${opening.name}. ${opening.intro}\n\nLet's start: play 1. ${firstMove} — I'll highlight the square for you.`;
    const current = lesson.chat[0];
    if (lesson.chat.length === 1 && current?.role === "coach" && current.content === freshIntro) return;
    updateLesson(lessonId, (l) => ({
      ...l,
      chat: [{ role: "coach" as const, content: freshIntro }],
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lessonId]);

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
    if (isComputerThinking) return false;

    // Use the persisted move list as the source of truth — `game.history()` returns
    // [] after the board is hydrated from a FEN on page reload (chess.js can't
    // reconstruct history from FEN alone), which would otherwise make every move
    // after a reload look "off-line" and skip the computer reply.
    const movesBefore = lesson.moves;
    const mode = `Lesson: ${lesson.name}`;
    const gameCopy = new Chess(game.fen());
    let result;
    try {
      result = gameCopy.move({ from, to, promotion: "q" });
    } catch {
      result = null;
    }

    if (!result) return false;

    const userSan = result.san;
    const gameLogBefore = resolveGameLog(lesson.moves, lesson.gameLog);
    const logAfterUser = appendStudentPlay(gameLogBefore, userSan);
    const afterUserFen = gameCopy.fen();

    setGame(gameCopy);
    clearSelection();

    // Full move list after the user's move (persisted source of truth).
    const movesAfterUser = [...movesBefore, userSan];

    // Check whether the user's move follows the opening's main line.
    const check = checkOpeningMove(lessonId, movesBefore, userSan);

    // Helper: post chat + persist current FEN/moves
    const pushUserAndCoach = (
      coachContent: string,
      finalFen: string,
      finalMoves: string[],
      trigger: "student_move" | "off_line_move" | "game_over" = "student_move",
      voiceHint?: string,
    ) => {
      updateLesson(lessonId, (l) => ({
        ...l,
        fen: finalFen,
        moves: finalMoves,
        gameLog: logAfterUser,
        status: l.status === "not_started" ? "started" : l.status,
        chat: [
          ...l.chat,
          { role: "user" as const, content: `Played ${userSan}`, moveNumber: movesBefore.length + 1 },
          { role: "coach" as const, content: coachContent },
        ],
      }));
      commentOnMove({
        gameLog: logAfterUser,
        trigger,
        mode,
        hint: voiceHint ?? `On-screen coach note: ${coachContent}`,
      });
    };

    // Off-line: gently correct the user. Don't auto-play.
    if (!check || check.kind === "off_line") {
      const expected = check && check.kind === "off_line" ? check.expected : null;
      const expectedNote = check && check.kind === "off_line" ? check.expectedNote : null;
      let msg: string;
      let voiceHint: string;
      if (expected) {
        msg = `That's not the main line of the ${lesson.name}. The recommended move is ${expected}.`;
        if (expectedNote) msg += ` ${expectedNote}`;
        msg += ` Tap undo and try again.`;
        voiceHint =
          `Wrong move for this lesson. The correct move is ${expected}.` +
          (expectedNote ? ` ${expectedNote}` : "") +
          ` Ask the student to tap undo to revert and try the recommended move.`;
      } else {
        msg = `You're past the main line I know — feel free to keep playing or tap undo to revisit.`;
        voiceHint =
          "The student is past the recorded main line. Ask them to tap undo if they want to return to the lesson line.";
      }
      setGame(gameCopy);
      pushUserAndCoach(msg, afterUserFen, movesAfterUser, "off_line_move", voiceHint);
      return true;
    }

    // Line exhausted: we're in free-play mode now — the engine takes over and
    // plays until the game ends (checkmate, stalemate, or draw).
    if (check.kind === "line_exhausted") {
      // 1) Did the user's move itself end the game?
      if (gameCopy.isGameOver()) {
        const endMsg = describeGameOver(gameCopy, lesson.name);
        setGame(gameCopy);
        pushUserAndCoach(endMsg, afterUserFen, movesAfterUser, "game_over");
        return true;
      }

      // 2) Otherwise, show the user's move and have the engine reply.
      updateLesson(lessonId, (l) => ({
        ...l,
        fen: afterUserFen,
        moves: movesAfterUser,
        gameLog: logAfterUser,
        status: l.status === "not_started" ? "started" : l.status,
        chat: [
          ...l.chat,
          { role: "user" as const, content: `Played ${userSan}`, moveNumber: movesBefore.length + 1 },
        ],
      }));
      setIsComputerThinking(true);

      const scheduledLessonId = lessonId;
      const scheduledFen = afterUserFen;

      if (pendingReplyRef.current !== null) {
        window.clearTimeout(pendingReplyRef.current);
      }

      pendingReplyRef.current = window.setTimeout(() => {
        pendingReplyRef.current = null;

        const engineSan = pickEngineMoveSan(scheduledFen);
        const afterEngine = new Chess(scheduledFen);
        let finalMoves = movesAfterUser;

        if (engineSan) {
          const applied = afterEngine.move(engineSan);
          if (applied) finalMoves = [...movesAfterUser, engineSan];
        }
        const finalFen = afterEngine.fen();

        let coachMsg: string;
        if (afterEngine.isGameOver()) {
          coachMsg = engineSan
            ? `I played ${engineSan}. ${describeGameOver(afterEngine, lesson.name)}`
            : describeGameOver(afterEngine, lesson.name);
        } else if (engineSan) {
          coachMsg = `I played ${engineSan}. Your move.`;
        } else {
          coachMsg = `I have no legal moves. ${describeGameOver(afterEngine, lesson.name)}`;
        }

        setGame(afterEngine);
        setIsComputerThinking(false);
        const logAfterCoach = engineSan
          ? appendCoachPlay(logAfterUser, engineSan)
          : logAfterUser;
        updateLesson(scheduledLessonId, (l) => ({
          ...l,
          fen: finalFen,
          moves: finalMoves,
          gameLog: logAfterCoach,
          chat: [...l.chat, { role: "coach" as const, content: coachMsg }],
        }));
        commentOnMove({
          gameLog: logAfterCoach,
          trigger: afterEngine.isGameOver() ? "game_over" : "coach_move",
          mode: `Free play in ${lesson.name}`,
          hint: afterEngine.isGameOver()
            ? describeGameOver(afterEngine, lesson.name)
            : undefined,
        });
      }, 600);

      return true;
    }

    // On-line: lesson complete?
    if (check.isComplete) {
      const opening = OPENINGS[lessonId];
      let msg = `Excellent — ${userSan} is correct.`;
      if (check.userMoveNote) msg += ` ${check.userMoveNote}`;
      msg += `\n\n${opening ? opening.finalNote : "You've completed this line!"}`;
      setGame(gameCopy);
      pushUserAndCoach(msg, afterUserFen, movesAfterUser);
      return true;
    }

    // On-line with a computer reply to play.
    const computerSan = check.nextComputerMove!;
    const nextUserMove = check.nextUserMove;
    const userMoveNote = check.userMoveNote;
    const computerMoveNote = check.computerMoveNote;
    const nextUserMoveNote = check.nextUserMoveNote;

    // Show the user's move immediately and mark the computer as thinking.
    updateLesson(lessonId, (l) => ({
      ...l,
      fen: afterUserFen,
      moves: movesAfterUser,
      gameLog: logAfterUser,
      status: l.status === "not_started" ? "started" : l.status,
      chat: [
        ...l.chat,
        { role: "user" as const, content: `Played ${userSan}`, moveNumber: movesBefore.length + 1 },
      ],
    }));
    setIsComputerThinking(true);

    // Capture the lesson id for the deferred updateLesson call.
    const scheduledLessonId = lessonId;
    const scheduledFen = afterUserFen;

    // Clear any prior pending reply before scheduling a new one.
    // (The useEffect cleanup also clears this on lessonId change / unmount,
    //  so a stale timeout cannot fire against the wrong lesson.)
    if (pendingReplyRef.current !== null) {
      window.clearTimeout(pendingReplyRef.current);
    }

    // Auto-play the computer's reply after a short delay so it feels natural.
    pendingReplyRef.current = window.setTimeout(() => {
      pendingReplyRef.current = null;

      const computerMove = sanToMove(scheduledFen, computerSan);
      if (!computerMove) {
        setIsComputerThinking(false);
        toast({ title: `Couldn't play computer move ${computerSan}`, variant: "destructive" });
        return;
      }
      const afterComputer = new Chess(scheduledFen);
      afterComputer.move(computerMove);
      const finalFen = afterComputer.fen();
      const finalMoves = [...movesAfterUser, computerSan];

      // Build a rich coach message: explain why each move was played and what's next.
      const parts: string[] = [];
      parts.push(
        userMoveNote
          ? `Good — ${userSan}. ${userMoveNote}`
          : `Good — ${userSan}.`,
      );
      parts.push(
        computerMoveNote
          ? `I played ${computerSan}. ${computerMoveNote}`
          : `I played ${computerSan}.`,
      );
      if (nextUserMove) {
        parts.push(
          nextUserMoveNote
            ? `Now play ${nextUserMove}. ${nextUserMoveNote}`
            : `Now play ${nextUserMove}.`,
        );
      } else {
        parts.push(`That's the end of the main line — well done!`);
      }
      const coachMsg = parts.join("\n\n");

      setGame(afterComputer);
      setIsComputerThinking(false);
      const logAfterCoach = appendCoachPlay(logAfterUser, computerSan);
      updateLesson(scheduledLessonId, (l) => ({
        ...l,
        fen: finalFen,
        moves: finalMoves,
        gameLog: logAfterCoach,
        chat: [
          ...l.chat,
          { role: "coach" as const, content: coachMsg },
        ],
      }));
      commentOnMove({
        gameLog: logAfterCoach,
        trigger: "coach_move",
        mode,
        hint: nextUserMove
          ? `Next recommended student move is ${nextUserMove}.` +
            (nextUserMoveNote ? ` ${nextUserMoveNote}` : "") +
            ` You must state this next move in spoken English.`
          : "That's the end of the recorded main line.",
      });
    }, 600);

    return true;
  };

  // Click interaction (react-chessboard v5 signature: { piece, square })
  const handleSquareClick = ({ square }: { square: string }) => {
    if (isComputerThinking) return;
    // User always plays White — never let them touch Black pieces or move when it's not White's turn.
    if (game.turn() !== "w") return;
    const sq = square as Square;

    const piece = game.get(sq);

    // Nothing selected yet — select only White pieces
    if (!selectedSquare) {
      if (piece && piece.color === "w") {
        setSelectedSquare(sq);
        setOptionSquares(getMoveOptions(sq));
      }
      return;
    }

    // Clicking the same square → deselect
    if (sq === selectedSquare) {
      clearSelection();
      return;
    }

    // Clicking another own White piece → reselect
    if (piece && piece.color === "w") {
      setSelectedSquare(sq);
      setOptionSquares(getMoveOptions(sq));
      return;
    }

    // Attempt the move
    const moved = executeMove(selectedSquare, sq);
    if (!moved) {
      // Not a legal target — deselect
      clearSelection();
    }
  };

  // Drag-and-drop (react-chessboard v5 signature: { piece, sourceSquare, targetSquare })
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
    // Source of truth for history is `lesson.moves` (not `game.history()`, which
    // is empty after the board is hydrated from a FEN on reload).
    if (lesson.moves.length === 0) return;

    // Pop the computer's reply (if the last move was Black) AND the user's move,
    // so it's the user's turn again after undo. For an off-line user move (no
    // computer reply played), only the user's move gets popped.
    const newMoves = [...lesson.moves];
    // Replay from the start to determine whose turn it is at the end.
    const replay = new Chess();
    newMoves.forEach((m) => replay.move(m));
    if (replay.turn() === "w") {
      // Last move was Black (computer) — pop both Black and White.
      newMoves.pop();
      newMoves.pop();
    } else {
      // Last move was White (user off-line) — pop just it.
      newMoves.pop();
    }

    // Rebuild the chess position from the trimmed move list.
    const rebuilt = new Chess();
    newMoves.forEach((m) => rebuilt.move(m));

    setGame(rebuilt);
    clearSelection();

    const gameLogBefore = resolveGameLog(lesson.moves, lesson.gameLog);
    const removed = removedPliesFromUndoneMoves(lesson.moves, newMoves.length);
    const logAfterUndo = appendRollback(gameLogBefore, removed);

    updateLesson(lessonId, (l) => {
      const newChat = [...l.chat];
      // Remove last coach + user pair from chat
      if (newChat.length >= 1 && newChat[newChat.length - 1].role === "coach") newChat.pop();
      if (newChat.length >= 1 && newChat[newChat.length - 1].role === "user") newChat.pop();
      return { ...l, fen: rebuilt.fen(), moves: newMoves, gameLog: logAfterUndo, chat: newChat };
    });

    if (removed.length > 0) {
      const opening = OPENINGS[lessonId];
      const nextUserMove = opening?.line[newMoves.length] ?? null;
      commentOnMove({
        gameLog: logAfterUndo,
        trigger: "undo",
        mode: `Lesson: ${lesson.name}`,
        hint: nextUserMove
          ? `After undo, remind the student their next move should be ${nextUserMove} in spoken English.`
          : undefined,
      });
    }
  };

  const handleReset = () => {
    if (!lessonId) return;
    const ok = window.confirm(
      `Reset "${lesson.name}"? Your moves and chat history for this lesson will be wiped.`,
    );
    if (!ok) return;

    // Cancel any pending engine reply so it can't fire against the reset state.
    if (pendingReplyRef.current !== null) {
      window.clearTimeout(pendingReplyRef.current);
      pendingReplyRef.current = null;
    }
    setIsComputerThinking(false);
    clearSelection();
    setGame(new Chess());

    const logWithReset = appendReset(resolveGameLog(lesson.moves, lesson.gameLog));

    resetLesson(lessonId);

    interruptAssistant();
    commentOnMove({
      gameLog: logWithReset,
      trigger: "reset",
      mode: `Lesson: ${lesson.name}`,
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
            disabled={lesson.moves.length === 0}
            className="text-muted-foreground"
            data-testid="button-undo"
          >
            <Undo2 className="w-5 h-5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={handleReset}
            disabled={lesson.moves.length === 0 && lesson.status === "not_started"}
            className="text-muted-foreground hover:text-destructive"
            title="Reset lesson"
            data-testid="button-reset"
          >
            <RotateCcw className="w-5 h-5" />
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
          <Link href="/settings">
            <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-foreground" title="Settings">
              <Settings className="w-5 h-5" />
            </Button>
          </Link>
        </div>
      </header>

      {/* Board */}
      <div
        className="flex-none bg-muted/30 border-b border-border p-4 flex justify-center"
        ref={containerRef}
      >
        <div
          className="rounded-sm overflow-hidden shadow-md"
          style={{ width: boardWidth, flexShrink: 0 }}
        >
          <Chessboard
            options={{
              position: game.fen(),
              onPieceDrop: handlePieceDrop,
              onSquareClick: handleSquareClick,
              squareStyles: boardSquareStyles,
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

          {/* Thinking indicator — always visible at the top */}
          {isComputerThinking && (
            <div className="flex max-w-[85%] mr-auto items-start">
              <div className="px-4 py-3 rounded-2xl bg-muted text-muted-foreground border border-border rounded-tl-sm flex items-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Coach is replying...</span>
              </div>
            </div>
          )}

          {/* Chat messages — newest first */}
          {([...(lesson.chat as ChatMessage[])].reverse()).map((msg, i) => (
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

          {/* First-time instructions — shown at the bottom as the oldest context */}
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
        </div>
      </div>
    </div>
  );
}
