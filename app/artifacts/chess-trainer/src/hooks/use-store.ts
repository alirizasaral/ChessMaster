import { useState, useEffect, useCallback } from "react";
import { OPENINGS } from "@/lib/openings";
import { type GameEvent, resolveGameLog } from "@/lib/game-transcript";

function buildWelcomeMessage(lessonId: string, lessonName: string, userName?: string): string {
  const greeting = userName ? `Welcome, ${userName}, to the` : `Welcome to the`;
  const opening = OPENINGS[lessonId];
  if (!opening) {
    return `${greeting} ${lessonName}. Play your first move when ready!`;
  }
  const firstMove = opening.line[0];
  return `${greeting} ${opening.name}. ${opening.intro}\n\nLet's start: play 1. ${firstMove} — I'll highlight the square for you.`;
}

export type LessonStatus = "not_started" | "started" | "finished";

export interface ChatMessage {
  role: "user" | "coach";
  content: string;
  moveNumber?: number;
}

export interface LessonData {
  id: string;
  name: string;
  description: string;
  status: LessonStatus;
  fen: string;
  moves: string[];
  gameLog: GameEvent[];
  chat: ChatMessage[];
  lastUpdated: string;
}

export interface AppSettings {
  sound: boolean;
  userName?: string;
}

export interface AppState {
  lessons: Record<string, LessonData>;
  settings: AppSettings;
}

interface LessonDef {
  id: string;
  name: string;
  description: string;
}

const INITIAL_LESSONS: LessonDef[] = [
  {
    id: "italian-game",
    name: "Italian Game",
    description: "Classical opening focused on rapid piece development and center control",
  },
  {
    id: "ruy-lopez",
    name: "Ruy Lopez",
    description: "One of the oldest and most respected openings, fighting for the center with tempo",
  },
  {
    id: "queens-gambit",
    name: "Queen's Gambit",
    description: "A powerful d4 opening that challenges Black's center immediately",
  },
  {
    id: "london-system",
    name: "London System",
    description: "Solid and reliable setup that works against almost anything",
  },
  {
    id: "sicilian-defense",
    name: "Sicilian Defense",
    description: "The most popular and combative response to 1.e4",
  },
  {
    id: "caro-kann",
    name: "Caro-Kann Defense",
    description: "A solid, positional response to 1.e4 with a strong pawn structure",
  }
];

const DEFAULT_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

function buildFreshLesson(def: LessonDef, userName?: string): LessonData {
  return {
    ...def,
    status: "not_started",
    fen: DEFAULT_FEN,
    moves: [],
    gameLog: [],
    chat: [{ role: "coach", content: buildWelcomeMessage(def.id, def.name, userName) }],
    lastUpdated: new Date().toISOString(),
  };
}

function normalizeLesson(lesson: LessonData): LessonData {
  return {
    ...lesson,
    gameLog: resolveGameLog(lesson.moves, lesson.gameLog),
  };
}

const createInitialState = (): AppState => {
  const lessons: Record<string, LessonData> = {};
  INITIAL_LESSONS.forEach((lesson) => {
    lessons[lesson.id] = buildFreshLesson(lesson);
  });

  return {
    lessons,
    settings: {
      sound: true,
    },
  };
};

const STORE_KEY = "chess-trainer";

export function useStore() {
  const [state, setState] = useState<AppState>(() => {
    try {
      const stored = localStorage.getItem(STORE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as AppState;
        const lessons: Record<string, LessonData> = {};
        for (const [id, lesson] of Object.entries(parsed.lessons)) {
          lessons[id] = normalizeLesson(lesson);
        }
        return {
          ...parsed,
          lessons,
          settings: {
            sound: parsed.settings?.sound ?? true,
            userName: parsed.settings?.userName?.trim() || undefined,
          },
        };
      }
    } catch (e) {
      console.error("Failed to load state from localStorage", e);
    }
    return createInitialState();
  });

  useEffect(() => {
    localStorage.setItem(STORE_KEY, JSON.stringify(state));
  }, [state]);

  const updateLesson = useCallback((id: string, updater: (lesson: LessonData) => LessonData) => {
    setState((prev) => {
      const currentLesson = prev.lessons[id];
      if (!currentLesson) return prev;
      return {
        ...prev,
        lessons: {
          ...prev.lessons,
          [id]: updater(currentLesson),
        },
      };
    });
  }, []);

  const toggleSound = useCallback(() => {
    setState((prev) => ({
      ...prev,
      settings: { ...prev.settings, sound: !prev.settings.sound },
    }));
  }, []);

  const setUserName = useCallback((name: string) => {
    const trimmed = name.trim();
    setState((prev) => ({
      ...prev,
      settings: { ...prev.settings, userName: trimmed || undefined },
    }));
  }, []);

  const resetLesson = useCallback((id: string) => {
    setState((prev) => {
      const def = INITIAL_LESSONS.find((l) => l.id === id);
      if (!def) return prev;
      return {
        ...prev,
        lessons: {
          ...prev.lessons,
          [id]: buildFreshLesson(def, prev.settings.userName),
        },
      };
    });
  }, []);

  const resetAllLessons = useCallback(() => {
    setState((prev) => {
      const lessons: Record<string, LessonData> = {};
      INITIAL_LESSONS.forEach((def) => {
        lessons[def.id] = buildFreshLesson(def, prev.settings.userName);
      });
      return { ...prev, lessons };
    });
  }, []);

  return {
    state,
    updateLesson,
    toggleSound,
    setUserName,
    resetLesson,
    resetAllLessons,
  };
}
