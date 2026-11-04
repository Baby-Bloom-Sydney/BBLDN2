/**
 * Arrow-key movement within one step of the call picker (brief 04 §2 picker semantics; 04b rework W4, W14). Pure.
 * Each step (days, times of day, times) is one radiogroup laid out in `columns`: Left/Right step through the open
 * tiles (wrapping), Up/Down move `columns` on to the nearest open tile in that column, Home/End go to the first/last.
 *
 * Arrows only move focus; choosing is Space/Enter or a tap, so arrowing never takes a hold (plan R17's intent).
 *
 * BB-wave1-041126/04b-rework, 2026-11-05.
 */

export type MoveKey = "ArrowLeft" | "ArrowRight" | "ArrowUp" | "ArrowDown" | "Home" | "End";

const MOVE_KEYS: ReadonlySet<string> = new Set(["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"]);

export function isMoveKey(key: string): key is MoveKey {
  return MOVE_KEYS.has(key);
}

/** The next open index stepping by `step` from `from` (exclusive), wrapping round `open`; null if none. */
function scanWrapping(open: readonly boolean[], from: number, step: 1 | -1): number | null {
  for (let n = 1; n <= open.length; n += 1) {
    const i = (from + step * n + open.length * n) % open.length;
    if (open[i]) return i;
  }
  return null;
}

function firstOpen(open: readonly boolean[]): number | null {
  const i = open.indexOf(true);
  return i === -1 ? null : i;
}

function lastOpen(open: readonly boolean[]): number | null {
  const i = open.lastIndexOf(true);
  return i === -1 ? null : i;
}

/** Within one row: Left/Right (wrapping), Home/End. */
function moveInRow(key: MoveKey, col: number, open: readonly boolean[]): number | null {
  if (key === "Home") return firstOpen(open);
  if (key === "End") return lastOpen(open);
  if (key === "ArrowRight") return scanWrapping(open, col, 1);
  if (key === "ArrowLeft") return scanWrapping(open, col, -1);
  return null;
}

/** One step's tiles, laid out in `columns`. Null = stay. */
export function moveInList(key: MoveKey, at: number, open: readonly boolean[], columns: number): number | null {
  let next: number | null = null;
  if (key === "ArrowUp" || key === "ArrowDown") {
    const step = key === "ArrowDown" ? columns : -columns;
    for (let i = at + step; i >= 0 && i < open.length; i += step) {
      if (open[i]) {
        next = i;
        break;
      }
    }
  } else {
    next = moveInRow(key, at, open);
  }
  return next === at ? null : next;
}
