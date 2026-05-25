// Main lines for each opening lesson, written in Standard Algebraic Notation (SAN).
// The user always plays White. Indices 0, 2, 4... are user moves; 1, 3, 5... are computer (Black) replies.
// `notes` is a parallel array — notes[i] explains why line[i] is played.

export interface OpeningLine {
  name: string;
  line: string[];
  notes: string[];
  intro: string;
  finalNote: string;
}

export const OPENINGS: Record<string, OpeningLine> = {
  "italian-game": {
    name: "Italian Game",
    line: ["e4", "e5", "Nf3", "Nc6", "Bc4", "Bc5", "c3", "Nf6", "d4", "exd4", "cxd4", "Bb4+"],
    notes: [
      "Stakes a claim in the center and opens lines for the queen and king's bishop.",
      "Black mirrors, fighting for the central squares.",
      "Develops the knight to its best square while attacking Black's e5 pawn.",
      "Defends e5 and develops naturally — the most popular reply.",
      "The 'Italian' bishop — it points straight at f7, Black's most vulnerable square.",
      "Black plays symmetrically; this is the Giuoco Piano ('Quiet Game').",
      "Prepares the central break d4, which will open lines for our better-developed pieces.",
      "Black develops the knight and quietly eyes our e4 pawn.",
      "The key central break — strike now, before Black is fully developed.",
      "Black captures to relieve the tension; this is the most popular reply.",
      "Recapture with the c-pawn maintains a strong pawn duo on d4 and e4.",
      "Black gives check to disrupt our development; this is the main Italian tabiya.",
    ],
    intro: "The Italian Game is one of the oldest and most natural openings in chess, dating back to the 1500s. White develops the king's bishop to c4, aiming straight at Black's weakest square — f7 — while quickly preparing to castle. It's a great first opening because the plans are clear: occupy the center, develop knights and bishops to active squares, and look for tactics around f7.",
    finalNote: "You've reached the main Italian Game tabiya. From here, White usually plays Nc3 or Bd2 to deal with the check.",
  },
  "ruy-lopez": {
    name: "Ruy Lopez",
    line: ["e4", "e5", "Nf3", "Nc6", "Bb5", "a6", "Ba4", "Nf6", "O-O", "Be7", "Re1", "b5", "Bb3", "d6"],
    notes: [
      "Opens the king's-pawn game — fights for the center and frees the queen and bishop.",
      "Black contests the center directly.",
      "Develops with a threat against e5.",
      "Defends the pawn and develops a piece — a perfect move.",
      "The Spanish bishop! It pins the knight against Black's king and indirectly attacks e5.",
      "The Morphy Defense — forces us to declare: capture or retreat?",
      "Retreats but keeps the long-diagonal pressure on Black's knight and king.",
      "Black develops and attacks our e4 pawn.",
      "Castles into safety and prepares Re1 to support the e4 pawn. (Black can grab e4 here — the Open Variation — but our setup gives long-term compensation.)",
      "A modest but flexible development — Black prepares to castle.",
      "Defends e4 and prepares to use the e-file once it opens.",
      "Gains queenside space and chases our bishop.",
      "The bishop retreats but stays on a strong diagonal, still eyeing f7.",
      "Solidifies the center and prepares to complete development with Nbd7 and a kingside setup.",
    ],
    intro: "The Ruy Lopez (also called the Spanish Opening) is considered the gold standard of 1.e4 openings — used by every World Champion from Steinitz to Carlsen. By pinning the knight on c6 with Bb5, White puts long-term pressure on Black's e5 pawn and central control. The result is a rich, strategic game with chances to play for a small but lasting advantage.",
    finalNote: "You've reached the Closed Ruy Lopez — one of the richest positions in chess.",
  },
  "queens-gambit": {
    name: "Queen's Gambit",
    line: ["d4", "d5", "c4", "e6", "Nc3", "Nf6", "Bg5", "Be7", "e3", "O-O", "Nf3", "Nbd7"],
    notes: [
      "Claims the center with a pawn that's already defended by the queen.",
      "Black contests the center symmetrically.",
      "The Queen's Gambit — offers a pawn to lure Black's d-pawn away from the center.",
      "The Queen's Gambit Declined (QGD): solid, classical, and rock-hard to crack.",
      "Develops with pressure on d5 — this is the Orthodox setup.",
      "Defends d5 and develops a piece.",
      "Pins the knight, increasing the pressure on d5 indirectly.",
      "Unpins by interposing — the standard Orthodox response.",
      "Modest but solid: opens the f1 bishop without weakening the structure.",
      "Black tucks the king to safety.",
      "Completes minor-piece development.",
      "Prepares to challenge in the center with ...c5 or ...dxc4 and unblocks the c-pawn.",
    ],
    intro: "The Queen's Gambit offers Black a pawn (c4) to lure them away from the center. It's not a true sacrifice — White can usually win the pawn back — but the real point is to dominate the d5 square and build a powerful central position. This is one of the most reliable openings at every level, prized for its solid structure and clear strategic plans.",
    finalNote: "This is the Queen's Gambit Declined, Orthodox Variation. White has a comfortable space advantage.",
  },
  "london-system": {
    name: "London System",
    line: ["d4", "d5", "Nf3", "Nf6", "Bf4", "c5", "e3", "Nc6", "c3", "e6", "Nbd2", "Bd6"],
    notes: [
      "Classical center grab — claims d4 and prepares smooth piece development.",
      "Black mirrors and challenges the center.",
      "Develops the knight to its natural square.",
      "Symmetrical development.",
      "The signature London move — the bishop comes out before being locked in by e3.",
      "Black strikes at our d4 pawn to challenge the center.",
      "Supports d4 and opens the diagonal for our f1 bishop.",
      "Develops and adds another attacker on d4.",
      "The London 'triangle' (c3-d4-e3) — rock-solid and impossible to break.",
      "Opens Black's light-square bishop.",
      "Connects the knights and prepares the e3-e4 break later.",
      "Challenges our strong f4 bishop, the heart of our setup.",
    ],
    intro: "The London System is a setup-based opening: White plays the same handful of moves (d4, Nf3, Bf4, e3, c3) almost regardless of what Black does. That makes it incredibly easy to learn and play, while still producing a rock-solid position with a great bishop on f4 and no weaknesses. It's a favorite of busy club players and even top grandmasters like Magnus Carlsen.",
    finalNote: "Classic London setup complete. The bishop on f4 and pawn triangle on c3-d4-e3 give White a solid, easy-to-play position.",
  },
  "sicilian-defense": {
    name: "Sicilian Defense (Open)",
    line: ["e4", "c5", "Nf3", "d6", "d4", "cxd4", "Nxd4", "Nf6", "Nc3", "a6", "Be2", "e5"],
    notes: [
      "Standard king's-pawn opening, fighting for the center.",
      "The Sicilian! Black declines symmetry and fights for the center asymmetrically — the most ambitious reply to 1.e4.",
      "Develops with central pressure and prepares the d4 break.",
      "Restrains e5 and prepares ...Nf6 without it being chased by e5.",
      "The Open Sicilian — we open the position to exploit our lead in development.",
      "The standard recapture, opening the c-file for Black's rook.",
      "Recaptures with the knight, which lands on a great central square.",
      "Develops with pressure on e4.",
      "Defends e4 and prepares queenside development.",
      "The Najdorf move — prepares ...b5 expansion and stops any Nb5 ideas.",
      "Quiet, flexible setup — keeps options for kingside expansion with f3-g4 or f4 ideas.",
      "Black grabs central space, accepting a weakness on d5 in exchange.",
    ],
    intro: "The Sicilian is Black's most ambitious reply to 1.e4 — by playing c5, Black fights for the center asymmetrically and creates winning chances from move one. As White in the Open Sicilian, you trade pawns in the center (d4) to open the position for your better-developed pieces. The resulting games are sharp, tactical, and full of opportunity for both sides.",
    finalNote: "You've played into the Najdorf Sicilian, one of the sharpest battlegrounds in chess.",
  },
  "caro-kann": {
    name: "Caro-Kann Defense",
    line: ["e4", "c6", "d4", "d5", "Nc3", "dxe4", "Nxe4", "Bf5", "Ng3", "Bg6", "h4", "h6"],
    notes: [
      "Standard king's-pawn opening.",
      "The Caro-Kann — prepares ...d5 without blocking Black's light-square bishop (unlike the French).",
      "Builds a classical big center.",
      "Black challenges the center head-on.",
      "Defends e4 and prepares to recapture on e4 with a piece if Black takes.",
      "Black trades to clarify the structure and reach a comfortable position.",
      "Recapture with the knight, putting it on a strong central square.",
      "The defining move — Black develops the bishop outside the pawn chain, the whole point of the Caro-Kann.",
      "Attacks the bishop and gains a tempo for the kingside.",
      "Retreats but keeps the bishop active on the b1-h7 diagonal.",
      "Aggressive! Probes the bishop and prepares h5 to soften Black's kingside.",
      "Prevents h5 from trapping the bishop and creates a luft for the king.",
    ],
    intro: "The Caro-Kann is one of Black's most respected defenses to 1.e4. By preparing d5 with c6, Black challenges White's center without blocking in the light-squared bishop — a common problem in similar openings like the French. The result is a solid, low-risk position with an excellent pawn structure. We'll learn it from White's side: how to handle Black's solid setup and play for a space advantage.",
    finalNote: "Classical Caro-Kann reached. Black has a solid pawn structure but White enjoys more space.",
  },
};

/**
 * Result of comparing the user's move to the expected line.
 * On-line results carry the notes for the user's move, the computer's reply, and the next expected user move.
 */
export type OpeningCheckResult =
  | { kind: "off_line"; expected: string; expectedNote: string | null }
  | { kind: "line_exhausted" }
  | {
      kind: "on_line";
      nextComputerMove: string | null;
      nextUserMove: string | null;
      userMoveNote: string | null;
      computerMoveNote: string | null;
      nextUserMoveNote: string | null;
      isComplete: boolean;
    };

/**
 * Given the move history (in SAN) and the user's just-played move (also in SAN),
 * determine whether the user is following the opening's main line.
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
    // We're past the end of the recorded line — we don't know whether the move is
    // good or bad, so don't claim it's "correct". Caller should show a neutral msg.
    return { kind: "line_exhausted" };
  }

  // Normalize: chess.js may add "+" / "#" — compare without them.
  const normalize = (m: string) => m.replace(/[+#]/g, "");
  if (normalize(userMove) !== normalize(expected)) {
    return {
      kind: "off_line",
      expected,
      expectedNote: opening.notes[userPly] ?? null,
    };
  }

  const nextComputerMove = opening.line[userPly + 1] ?? null;
  const nextUserMove = opening.line[userPly + 2] ?? null;
  const isComplete = nextComputerMove === null;
  return {
    kind: "on_line",
    nextComputerMove,
    nextUserMove,
    userMoveNote: opening.notes[userPly] ?? null,
    computerMoveNote: opening.notes[userPly + 1] ?? null,
    nextUserMoveNote: opening.notes[userPly + 2] ?? null,
    isComplete,
  };
}
