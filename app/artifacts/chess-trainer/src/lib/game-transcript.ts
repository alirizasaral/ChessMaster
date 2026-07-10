export type GamePlayer = "student" | "coach";

export type RemovedPly = {
  player: GamePlayer;
  san: string;
  plyIndex: number;
};

export type GameEvent =
  | { type: "play"; player: GamePlayer; san: string; plyIndex: number }
  | { type: "rollback"; removed: RemovedPly[] }
  | { type: "reset" };

export function playerForPlyIndex(index: number): GamePlayer {
  return index % 2 === 0 ? "student" : "coach";
}

/** Ply count on the board after replaying the append-only log. */
export function boardPlyCount(log: GameEvent[]): number {
  let count = 0;
  for (const event of log) {
    if (event.type === "play") {
      count += 1;
    } else if (event.type === "rollback") {
      count -= event.removed.length;
    } else if (event.type === "reset") {
      count = 0;
    }
  }
  return count;
}

export function appendPlay(log: GameEvent[], player: GamePlayer, san: string): GameEvent[] {
  const plyIndex = boardPlyCount(log);
  return [...log, { type: "play", player, san, plyIndex }];
}

export function appendStudentPlay(log: GameEvent[], san: string): GameEvent[] {
  return appendPlay(log, "student", san);
}

export function appendCoachPlay(log: GameEvent[], san: string): GameEvent[] {
  return appendPlay(log, "coach", san);
}

/**
 * Build rollback entries from the slice of moves removed by undo.
 * `startPlyIndex` is the ply index of the first removed move (length of trimmed list).
 */
export function removedPliesFromUndoneMoves(
  movesBeforeUndo: string[],
  newMovesLength: number,
): RemovedPly[] {
  const undone = movesBeforeUndo.slice(newMovesLength);
  return undone.map((san, i) => ({
    player: playerForPlyIndex(newMovesLength + i),
    san,
    plyIndex: newMovesLength + i,
  }));
}

export function appendRollback(log: GameEvent[], removed: RemovedPly[]): GameEvent[] {
  if (removed.length === 0) return log;
  return [...log, { type: "rollback", removed }];
}

export function appendReset(log: GameEvent[]): GameEvent[] {
  return [...log, { type: "reset" }];
}

function formatPlayLine(plyIndex: number, player: GamePlayer, san: string): string {
  const fullMove = Math.floor(plyIndex / 2) + 1;
  if (player === "student") {
    return `${fullMove}.   student: ${san}`;
  }
  return `${fullMove}... coach: ${san}`;
}

function formatRemovedPly({ player, san, plyIndex }: RemovedPly): string {
  const fullMove = Math.floor(plyIndex / 2) + 1;
  if (player === "coach") {
    return `${fullMove}... coach ${san}`;
  }
  return `${fullMove}. student ${san}`;
}

/**
 * Format the append-only event log for the Realtime API.
 * Includes plays, UNDO markers, and RESET markers with student/coach labels.
 */
export function formatGameTranscript(log: GameEvent[]): string {
  if (log.length === 0) {
    return "(no moves yet)";
  }

  const lines: string[] = [];

  for (const event of log) {
    if (event.type === "play") {
      lines.push(formatPlayLine(event.plyIndex, event.player, event.san));
    } else if (event.type === "rollback") {
      const reverted = event.removed.map(formatRemovedPly).join(", ");
      lines.push(`UNDO: reverted ${reverted}`);
    } else if (event.type === "reset") {
      lines.push("RESET: board returned to starting position");
    }
  }

  return lines.join("\n");
}

/** Rebuild play-only move list from the event log (current board position). */
export function currentMovesFromLog(log: GameEvent[]): string[] {
  const moves: string[] = [];
  for (const event of log) {
    if (event.type === "play") {
      moves.push(event.san);
    } else if (event.type === "rollback") {
      moves.splice(-event.removed.length);
    } else if (event.type === "reset") {
      moves.length = 0;
    }
  }
  return moves;
}

/** Bootstrap a game log from persisted SAN moves (migration for older saves). */
export function bootstrapGameLogFromMoves(moves: string[]): GameEvent[] {
  return moves.map((san, i) => ({
    type: "play" as const,
    player: playerForPlyIndex(i),
    san,
    plyIndex: i,
  }));
}

/** Use persisted gameLog or bootstrap from moves when missing. */
export function resolveGameLog(moves: string[], gameLog?: GameEvent[]): GameEvent[] {
  if (gameLog && gameLog.length > 0) return gameLog;
  if (gameLog && gameLog.length === 0 && moves.length === 0) return [];
  if (moves.length > 0) return bootstrapGameLogFromMoves(moves);
  return gameLog ?? [];
}
