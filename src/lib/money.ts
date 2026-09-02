// The one and only home for kwacha <-> ngwee conversion (CLAUDE.md Absolute
// Rule 2). Money is stored as an integer count of minor units (ngwee); the
// currency lives in a separate adjacent field. Nothing outside this file is
// allowed to convert between the two — no `parseFloat(x) * 100` in an action or
// a component, ever, because `250.10 * 100` is `25009.999...` in IEEE 754 and
// truncates a price one ngwee short, silently.
//
// The parser works on the *string*: it splits on the decimal point, checks the
// fraction is at most two digits, and combines the two halves with integer
// arithmetic only.

export type MoneyParseResult =
  | { ok: true; minor: number }
  | { ok: false; error: string };

const KWACHA_SHAPE = /^(\d+)(?:\.(\d+))?$/;

/**
 * Parse a kwacha amount typed by a human ("250", "250.10", " 250.00 ") into an
 * integer number of ngwee. Rejects signs, thousands separators, exponent
 * notation, currency symbols, more than two decimal places, and anything else
 * that is not plain `digits[.digits]`.
 */
export function parseKwachaToMinor(raw: unknown): MoneyParseResult {
  if (typeof raw !== "string") {
    return { ok: false, error: "Enter a price." };
  }

  const trimmed = raw.trim();
  if (trimmed === "") {
    return { ok: false, error: "Enter a price." };
  }

  if (/^[+-]/.test(trimmed)) {
    return {
      ok: false,
      error: "Enter a price of zero or more, with no + or − sign.",
    };
  }

  const match = KWACHA_SHAPE.exec(trimmed);
  if (!match) {
    return {
      ok: false,
      error:
        "Enter the price in kwacha, e.g. 250.00 — digits and one decimal point only.",
    };
  }

  const [, whole, fraction = ""] = match;
  if (fraction.length > 2) {
    return {
      ok: false,
      error: "A price can have at most 2 decimal places (ngwee).",
    };
  }

  // Integer arithmetic only. `whole` is a run of digits, so `Number(whole)` is
  // exact up to Number.MAX_SAFE_INTEGER; `* 100` on an integer is exact; the
  // fraction is a 0-2 digit integer.
  const minor = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(minor)) {
    return { ok: false, error: "That price is too large." };
  }

  return { ok: true, minor };
}

/**
 * Format an integer ngwee amount for display: `formatMinor(25050)` -> "K250.50",
 * `formatMinor(10000001)` -> "K100,000.01". ZMW renders with a "K" prefix; any
 * other currency code is prefixed as-is ("USD 250.00").
 */
export function formatMinor(minor: number, currency = "ZMW"): string {
  const negative = minor < 0;
  const abs = Math.abs(Math.trunc(minor));
  const whole = Math.trunc(abs / 100);
  const fraction = String(abs % 100).padStart(2, "0");
  const grouped = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const prefix = currency === "ZMW" ? "K" : `${currency} `;
  return `${negative ? "-" : ""}${prefix}${grouped}.${fraction}`;
}

/**
 * Integer ngwee -> the bare decimal string a form field wants as its value:
 * `minorToDecimalString(25010)` -> "250.10". No currency symbol, no grouping.
 */
export function minorToDecimalString(minor: number): string {
  const abs = Math.abs(Math.trunc(minor));
  return `${Math.trunc(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}
