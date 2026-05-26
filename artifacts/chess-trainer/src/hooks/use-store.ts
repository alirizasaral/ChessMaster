import { useState, useEffect, useCallback } from "react";
import { OPENINGS } from "@/lib/openings";

function buildWelcomeMessage(lessonId: string, lessonName: string): string {
  const opening = OPENINGS[lessonId];
  if (!opening) {
    return `Welcome to the ${lessonName}. Play your first move when ready!`;
  }
  const firstMove = opening.line[0];
  return `Welcome to the ${opening.name}. ${opening.intro}\n\nLet's start: play 1. ${firstMove} — I'll highlight the square for you.`;
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
  chat: ChatMessage[];
  lastUpdated: string;
}

export interface AppSettings {
  sound: boolean;
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

function buildFreshLesson(def: LessonDef): LessonData {
  return {
    ...def,
    status: "not_started",
    fen: DEFAULT_FEN,
    moves: [],
    chat: [{ role: "coach", content: buildWelcomeMessage(def.id, def.name) }],
    lastUpdated: new Date().toISOString(),
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
        return JSON.parse(stored);
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

  const resetLesson = useCallback((id: string) => {
    setState((prev) => {
      const def = INITIAL_LESSONS.find((l) => l.id === id);
      if (!def) return prev;
      return {
        ...prev,
        lessons: {
          ...prev.lessons,
          [id]: buildFreshLesson(def),
        },
      };
    });
  }, []);

  const resetAllLessons = useCallback(() => {
    setState((prev) => {
      const lessons: Record<string, LessonData> = {};
      INITIAL_LESSONS.forEach((def) => {
        lessons[def.id] = buildFreshLesson(def);
      });
      return { ...prev, lessons };
    });
  }, []);

  return {
    state,
    updateLesson,
    toggleSound,
    resetLesson,
    resetAllLessons,
  };
}
