// Main lines for each opening lesson, written in Standard Algebraic Notation (SAN).
// The user always plays White. Indices 0, 2, 4... are user moves; 1, 3, 5... are computer (Black) replies.

export interface OpeningLine {
  name: string;
  line: string[];
  finalNote: string;
}

export const OPENINGS: Record<string, OpeningLine> = {
  "italian-game": {
    name: "Italian Game",
    line: ["e4", "e5", "Nf3", "Nc6", "Bc4", "Bc5", "c3", "Nf6", "d4", "exd4", "cxd4", "Bb4+"],
    finalNote: "You've reached the main Italian Game tabiya. From here, White usually plays Nc3 or Bd2 to deal with the check.",
  },
  "ruy-lopez": {
    name: "Ruy Lopez",
    line: ["e4", "e5", "Nf3", "Nc6", "Bb5", "a6", "Ba4", "Nf6", "O-O", "Be7", "Re1", "b5", "Bb3", "d6"],
    finalNote: "You've reached the Closed Ruy Lopez — one of the richest positions in chess.",
  },
  "queens-gambit": {
    name: "Queen's Gambit",
    line: ["d4", "d5", "c4", "e6", "Nc3", "Nf6", "Bg5", "Be7", "e3", "O-O", "Nf3", "Nbd7"],
    finalNote: "This is the Queen's Gambit Declined, Orthodox Variation. White has a comfortable space advantage.",
  },
  "london-system": {
    name: "London System",
    line: ["d4", "d5", "Nf3", "Nf6", "Bf4", "c5", "e3", "Nc6", "c3", "e6", "Nbd2", "Bd6"],
    finalNote: "Classic London setup complete. The bishop on f4 and pawn triangle on c3-d4-e3 give White a solid, easy-to-play position.",
  },
  "sicilian-defense": {
    name: "Sicilian Defense (Open)",
    line: ["e4", "c5", "Nf3", "d6", "d4", "cxd4", "Nxd4", "Nf6", "Nc3", "a6", "Be2", "e5"],
    finalNote: "You've played into the Najdorf Sicilian, one of the sharpest battlegrounds in chess.",
  },
  "caro-kann": {
    name: "Caro-Kann Defense",
    line: ["e4", "c6", "d4", "d5", "Nc3", "dxe4", "Nxe4", "Bf5", "Ng3", "Bg6", "h4", "h6"],
    finalNote: "Classical Caro-Kann reached. Black has a solid pawn structure but White enjoys more space.",
  },
};

/**
 * Result of comparing the user's move to the expected line.
 */
export type OpeningCheckResult =
  | { kind: "off_line"; expected: string }
  | { kind: "on_line"; nextComputerMove: string | null; nextUserMove: string | null; isComplete: boolean };

/**
 * Given the move history (in SAN) and the user's just-played move (also in SAN),
 * determine whether the user is following the opening's main line.
 *
 * @param lessonId   The opening lesson id (key into OPENINGS)
 * @param movesBefore The full move history BEFORE the user's just-played move
 * @param userMove   The user's just-played move in SAN
 */
export function checkOpeningMove(
  lessonId: string,
  movesBefore: string[],
  userMove: string,
): OpeningCheckResult | null {
  const opening = OPENINGS[lessonId];
  if (!opening) return null;

  const userPly = movesBefore.length; // 0 = user's 1st move, 2 = user's 2nd move, etc.
  const expected = opening.line[userPly];
  if (!expected) {
    // We're past the end of the recorded line — treat as on-line with nothing left
    return { kind: "on_line", nextComputerMove: null, nextUserMove: null, isComplete: true };
  }

  // Normalize: chess.js may add "+" / "#" — compare without them and also ignore "x" capture marker if needed.
  const normalize = (m: string) => m.replace(/[+#]/g, "");
  if (normalize(userMove) !== normalize(expected)) {
    return { kind: "off_line", expected };
  }

  const nextComputerMove = opening.line[userPly + 1] ?? null;
  const nextUserMove = opening.line[userPly + 2] ?? null;
  const isComplete = nextComputerMove === null;
  return { kind: "on_line", nextComputerMove, nextUserMove, isComplete };
}
