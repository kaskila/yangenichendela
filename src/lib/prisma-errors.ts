import { Prisma } from "@/generated/prisma/client";

// Identifying WHICH unique constraint a P2002 violated, done once. Prisma 7 with
// @prisma/adapter-pg does NOT populate `error.meta.target` — the constraint name
// lands under `error.meta.driverAdapterError.cause` and in the raw message. Any
// code that needs to know which constraint fired must check every location, so
// it checks them here and nowhere else.
//
// This never broadens a catch: callers still act only on a P2002 that names the
// constraint they expect, and rethrow everything else.

export function isUniqueConstraintError(
  error: unknown,
): error is Prisma.PrismaClientKnownRequestError {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  );
}

/**
 * Lowercased text pulled from every place the violated constraint might be
 * named: `meta.target` (empty on the pg adapter, populated elsewhere), the
 * serialised `meta.driverAdapterError.cause`, and the raw message.
 */
export function uniqueConstraintText(
  error: Prisma.PrismaClientKnownRequestError,
): string {
  const meta = error.meta as
    | { target?: unknown; driverAdapterError?: { cause?: unknown } }
    | undefined;

  let cause = "";
  try {
    cause = JSON.stringify(meta?.driverAdapterError?.cause ?? "");
  } catch {
    // non-serialisable cause — the message and target still cover us
  }

  const target = Array.isArray(meta?.target)
    ? meta.target.join(" ")
    : String(meta?.target ?? "");

  return [target, cause, error.message].join(" ").toLowerCase();
}

/**
 * True when `error` is a P2002 whose constraint name / columns contain `needle`
 * (case-insensitive). Pass a column name ("slug") or a distinctive fragment of
 * the constraint ("transactionidnorm").
 */
export function isUniqueViolationOn(error: unknown, needle: string): boolean {
  return (
    isUniqueConstraintError(error) &&
    uniqueConstraintText(error).includes(needle.toLowerCase())
  );
}
