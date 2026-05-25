import { useState, useEffect, useRef, useCallback } from "react";
import { useParams, Link } from "wouter";
import { Chess } from "chess.js";
import { Chessboard } from "react-chessboard";
import { useStore } from "@/hooks/use-store";
import { useGetCoachFeedback } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ArrowLeft, Undo2, Check, Volume2, VolumeX, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

export default function Lesson() {
  const { lessonId } = useParams();
  const { state, updateLesson, toggleSound } = useStore();
  const { toast } = useToast();
  
  const lesson = lessonId ? state.lessons[lessonId] : null;
  const soundEnabled = state.settings.sound;

  const [game, setGame] = useState(new Chess());
  const [boardWidth, setBoardWidth] = useState(300);
  const containerRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  
  const coachMutation = useGetCoachFeedback();

  // Play TTS
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

  // Init game state
  useEffect(() => {
    if (lesson?.fen) {
      try {
        const newGame = new Chess(lesson.fen);
        setGame(newGame);
      } catch (e) {
        console.error("Invalid FEN", e);
      }
    }
  }, [lesson?.fen]);

  // Resize board
  useEffect(() => {
    const handleResize = () => {
      if (containerRef.current) {
        const width = Math.min(containerRef.current.clientWidth, 600);
        setBoardWidth(width - 32); // padding
      }
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

  const handlePieceDrop = (sourceSquare: string, targetSquare: string) => {
    if (coachMutation.isPending) return false;

    const move = {
      from: sourceSquare,
      to: targetSquare,
      promotion: "q",
    };

    try {
      const result = game.move(move);
      if (!result) throw new Error("Illegal move");

      const newFen = game.fen();
      const moveHistory = game.history();
      const lastMove = result.san;

      updateLesson(lessonId, (l) => ({
        ...l,
        fen: newFen,
        moves: moveHistory,
        status: l.status === "not_started" ? "started" : l.status,
        chat: [
          ...l.chat,
          { role: "user", content: `Played ${lastMove}`, moveNumber: moveHistory.length }
        ]
      }));

      // Call Coach API
      coachMutation.mutate({
        data: {
          lessonId,
          lessonName: lesson.name,
          fen: newFen,
          moves: moveHistory,
          lastMove
        }
      }, {
        onSuccess: (res) => {
          updateLesson(lessonId, (l) => ({
            ...l,
            chat: [
              ...l.chat,
              { role: "coach", content: res.feedback }
            ]
          }));
          playAudio(res.feedback);
        },
        onError: () => {
          toast({ title: "Error getting feedback", variant: "destructive" });
        }
      });

      return true;
    } catch (e) {
      toast({ title: "Illegal move", duration: 1500 });
      return false;
    }
  };

  const handleUndo = () => {
    try {
      game.undo();
      const newFen = game.fen();
      const moveHistory = game.history();
      
      updateLesson(lessonId, (l) => {
        // Remove the last user move and coach response
        const newChat = [...l.chat];
        if (newChat.length >= 2 && newChat[newChat.length - 1].role === "coach") {
          newChat.pop(); // remove coach
          newChat.pop(); // remove user
        }
        
        return {
          ...l,
          fen: newFen,
          moves: moveHistory,
          chat: newChat
        };
      });
    } catch (e) {
      console.error(e);
    }
  };

  const handleFinish = () => {
    updateLesson(lessonId, (l) => ({ ...l, status: "finished" }));
    toast({ title: "Lesson marked as finished!" });
  };

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
            <p className="text-xs text-muted-foreground mt-1 capitalize">{lesson.status.replace('_', ' ')}</p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" onClick={toggleSound} className="text-muted-foreground" title={soundEnabled ? "Mute" : "Unmute"}>
            {soundEnabled ? <Volume2 className="w-5 h-5" /> : <VolumeX className="w-5 h-5" />}
          </Button>
          <Button variant="ghost" size="icon" onClick={handleUndo} disabled={lesson.moves.length === 0} className="text-muted-foreground">
            <Undo2 className="w-5 h-5" />
          </Button>
          <Button variant="ghost" size="icon" onClick={handleFinish} className="text-primary hover:text-primary/80 hover:bg-primary/10">
            <Check className="w-5 h-5" />
          </Button>
        </div>
      </header>

      {/* Board */}
      <div className="flex-none bg-muted/30 border-b border-border p-4 flex justify-center" ref={containerRef}>
        <div className="rounded-sm overflow-hidden shadow-md">
          <Chessboard 
            position={lesson.fen} 
            onPieceDrop={handlePieceDrop}
            boardWidth={boardWidth}
            customDarkSquareStyle={{ backgroundColor: 'hsl(var(--primary))' }}
            customLightSquareStyle={{ backgroundColor: 'hsl(var(--secondary))' }}
            animationDuration={200}
          />
        </div>
      </div>

      {/* Chat Area */}
      <div className="flex-1 overflow-hidden flex flex-col bg-card">
        <div 
          className="flex-1 overflow-y-auto p-4 space-y-4"
          ref={scrollRef}
        >
          {lesson.chat.map((msg, i) => (
            <div 
              key={i} 
              className={`flex flex-col max-w-[85%] ${msg.role === 'user' ? 'ml-auto items-end' : 'mr-auto items-start'}`}
            >
              <div 
                className={`px-4 py-3 rounded-2xl text-sm leading-relaxed ${
                  msg.role === 'user' 
                    ? 'bg-primary text-primary-foreground rounded-tr-sm' 
                    : 'bg-muted text-foreground border border-border rounded-tl-sm'
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
