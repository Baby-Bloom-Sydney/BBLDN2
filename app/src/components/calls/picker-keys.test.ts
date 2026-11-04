/**
 * Arrow keys in the call picker (04b rework W4; brief §2 picker semantics): they move focus between open cells and
 * open times only — a greyed one is skipped, never landed on — and never choose (so arrowing never takes a hold).
 */
import { describe, expect, it } from "vitest";
import { isMoveKey, moveInList } from "./picker-keys";

const T = true;
const F = false;

describe("moveInList (the time box, four columns)", () => {
  const open = [T, F, T, T, F, T, F, F, T];

  it("Left/Right step through open times, skipping greyed ones, wrapping", () => {
    expect(moveInList("ArrowRight", 0, open, 4)).toBe(2);
    expect(moveInList("ArrowRight", 8, open, 4)).toBe(0);
    expect(moveInList("ArrowLeft", 2, open, 4)).toBe(0);
  });

  it("Up/Down move a row to the nearest open time in that column", () => {
    expect(moveInList("ArrowDown", 0, open, 4)).toBe(8);
    expect(moveInList("ArrowUp", 8, open, 4)).toBe(0);
    expect(moveInList("ArrowDown", 3, open, 4)).toBeNull();
  });

  it("Home/End; a single open time stays put", () => {
    expect(moveInList("Home", 5, open, 4)).toBe(0);
    expect(moveInList("End", 0, open, 4)).toBe(8);
    expect(moveInList("ArrowRight", 0, [T, F, F], 4)).toBeNull();
  });
});

describe("isMoveKey", () => {
  it("only the arrows, Home and End", () => {
    for (const key of ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"]) expect(isMoveKey(key)).toBe(true);
    for (const key of ["Enter", " ", "Tab", "a"]) expect(isMoveKey(key)).toBe(false);
  });
});
