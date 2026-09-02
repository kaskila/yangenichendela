import { describe, expect, it } from "vitest";

// Proves the test runner and the @/* alias resolve. Real service and
// state-transition tests replace this as the build order progresses.
describe("smoke", () => {
  it("runs", () => {
    expect(1 + 1).toBe(2);
  });
});
