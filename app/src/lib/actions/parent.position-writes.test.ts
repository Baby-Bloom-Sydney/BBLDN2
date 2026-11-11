/**
 * A family's position is written field by field (`saveTypeformPosition`); no exported action writes a position from
 * an object the browser sends.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(join(__dirname, "parent.ts"), "utf8");

describe("position writes from the browser", () => {
  it.each(["createPosition", "updatePosition"])("%s is not an action", (name) => {
    expect(source).not.toMatch(new RegExp(`export\\s+async\\s+function\\s+${name}\\b`));
  });

  it("the field-by-field save is still there", () => {
    expect(source).toMatch(/export\s+async\s+function\s+saveTypeformPosition\b/);
  });
});
