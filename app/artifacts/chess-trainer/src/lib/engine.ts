// Lightweight chess AI used after the recorded opening line is finished.
// Wraps `js-chess-engine` and converts its {FROM: TO} move format into SAN
// (Standard Algebraic Notation) using chess.js so the rest of the app — which
// already speaks SAN — can keep working without changes.

import { aiMove } from "js-chess-engine";
import { Chess } from "chess.js";

/**
 * Ask the engine for a reply move and return it in SAN.
 *
 * @param fen   Current position (it's the engine's turn in this FEN).
 * @param level 1 = beginner ... 5 = grandmaster. Default 5 (max strength).
 * @returns SAN string (e.g. "Nf3", "Qxe7+") or null if there's no legal move
 *          (i.e. the position is already game-over).
 */
export function pickEngineMoveSan(fen: string, level = 5): string | null {
  try {
    const raw = aiMove(fen, level) as Record<string, string>;
    const entry = Object.entries(raw)[0];
    if (!entry) return null;
    const [fromUpper, toUpper] = entry;
    const from = fromUpper.toLowerCase();
    const to = toUpper.toLowerCase();

    const chess = new Chess(fen);
    // Default to queen promotion — the engine doesn't specify a promotion piece.
    const move = chess.move({ from, to, promotion: "q" });
    return move ? move.san : null;
  } catch {
    return null;
  }
}

/**
 * Human-readable description of a finished game's result.
 * Assumes White = the human user and Black = the computer.
 */
export function describeGameOver(chess: Chess, lessonName: string): string {
  const tail = ` Tap undo to revisit the ${lessonName} mainline.`;
  if (chess.isCheckmate()) {
    // chess.turn() returns the side TO move — i.e. the side that has just been mated.
    const userMated = chess.turn() === "w";
    return userMated
      ? `Checkmate — I won this one. Good game!${tail}`
      : `Checkmate! You won — beautifully played.${tail}`;
  }
  if (chess.isStalemate()) return `Stalemate — that's a draw.${tail}`;
  if (chess.isThreefoldRepetition()) return `Draw by threefold repetition.${tail}`;
  if (chess.isInsufficientMaterial()) return `Draw — neither side has enough material to mate.${tail}`;
  if (chess.isDraw()) return `Draw (50-move rule).${tail}`;
  return `Game over.${tail}`;
}
