import { describe, expect, it } from "vitest";
import { failureCode } from "./failure-code";

describe("failureCode", () => {
  it("is the error's code", () => {
    expect(failureCode({ code: "23514", message: "x", details: "Failing row contains (a)" })).toBe("23514");
  });

  it("is Error when there is no usable code", () => {
    for (const e of [null, undefined, "boom", new Error("boom"), { code: "" }, { code: 42 }, { message: "x" }]) expect(failureCode(e)).toBe("Error");
  });
});
