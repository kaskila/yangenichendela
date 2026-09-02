import { describe, expect, it } from "vitest";
import {
  formatMinor,
  minorToDecimalString,
  parseKwachaToMinor,
} from "@/lib/money";

// Pure unit tests — no database. The point of this file is CLAUDE.md Absolute
// Rule 2: string parsing, exact integer conversion, and the failure messages an
// admin sees when they mistype a price.

function assertOk(r: ReturnType<typeof parseKwachaToMinor>): asserts r is {
  ok: true;
  minor: number;
} {
  if (!r.ok) throw new Error(`expected ok, got error: ${r.error}`);
}

describe("parseKwachaToMinor — valid input", () => {
  it.each([
    ["250.10", 25010],
    ["250.05", 25005],
    ["0.01", 1],
    ["100000.01", 10000001], // above 100,000 kwacha
    ["250000.00", 25000000],
    ["250", 25000],
    ["250.1", 25010],
    ["  250.00  ", 25000],
    ["0", 0],
    ["0.00", 0],
    ["007.5", 750], // leading zeros tolerated
  ])("parses %j to %d ngwee", (input, expected) => {
    const result = parseKwachaToMinor(input);
    assertOk(result);
    expect(result.minor).toBe(expected);
  });

  it("never loses a ngwee to floating point (the 250.10 case)", () => {
    // parseFloat("250.10") * 100 === 25009.999999999996 -> would truncate to 25009
    const result = parseKwachaToMinor("250.10");
    assertOk(result);
    expect(result.minor).toBe(25010);
  });
});

describe("parseKwachaToMinor — rejected input", () => {
  it("rejects more than 2 decimal places", () => {
    const result = parseKwachaToMinor("10.999");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/2 decimal places/);
  });

  it("rejects negatives with a clear message", () => {
    const result = parseKwachaToMinor("-5");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/sign/);
  });

  it.each(["abc", "250,000", "1e3", "K250", "250.", ".5", "12 50"])(
    "rejects non-numeric input %j",
    (input) => {
      const result = parseKwachaToMinor(input);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toMatch(/kwacha/);
    },
  );

  it.each(["", "   "])("rejects empty input %j", (input) => {
    const result = parseKwachaToMinor(input);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/Enter a price/);
  });

  it("rejects non-string input", () => {
    expect(parseKwachaToMinor(250 as unknown).ok).toBe(false);
    expect(parseKwachaToMinor(null).ok).toBe(false);
    expect(parseKwachaToMinor(undefined).ok).toBe(false);
  });

  it("rejects an amount too large to hold exactly", () => {
    const result = parseKwachaToMinor("9".repeat(20));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/too large/);
  });
});

describe("formatMinor", () => {
  it.each([
    [25050, "ZMW", "K250.50"],
    [25010, "ZMW", "K250.10"],
    [1, "ZMW", "K0.01"],
    [0, "ZMW", "K0.00"],
    [10000001, "ZMW", "K100,000.01"],
    [123456789, "ZMW", "K1,234,567.89"],
    [-25050, "ZMW", "-K250.50"],
    [25000, "USD", "USD 250.00"],
  ])("formats %d %s as %j", (minor, currency, expected) => {
    expect(formatMinor(minor, currency)).toBe(expected);
  });

  it("defaults the currency to ZMW", () => {
    expect(formatMinor(25050)).toBe("K250.50");
  });
});

describe("minorToDecimalString", () => {
  it.each([
    [25010, "250.10"],
    [1, "0.01"],
    [0, "0.00"],
    [10000001, "100000.01"],
  ])("turns %d into the form value %j", (minor, expected) => {
    expect(minorToDecimalString(minor)).toBe(expected);
  });
});

describe("round trip", () => {
  it.each(["250.10", "250.05", "0.01", "100000.01", "250", "1"])(
    "parse -> format -> parse is stable for %j",
    (input) => {
      const first = parseKwachaToMinor(input);
      assertOk(first);
      const formatted = formatMinor(first.minor).replace(/^K/, "").replace(/,/g, "");
      const second = parseKwachaToMinor(formatted);
      assertOk(second);
      expect(second.minor).toBe(first.minor);
    },
  );
});
