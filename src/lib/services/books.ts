import { z } from "zod";
import { db } from "@/lib/db";
import type { Book, BookFormat, BookFormatType } from "@/generated/prisma/client";
import { parseKwachaToMinor } from "@/lib/money";
import { isUniqueViolationOn } from "@/lib/prisma-errors";
import { slugify } from "@/lib/slug";

// Book management service. Mirrors src/lib/services/registration.ts: a Zod schema
// at the front, discriminated results, P2002 handled here, and NO authorization
// (that belongs to the server-action layer so tests can drive this directly).
//
// CLAUDE.md rules honoured here:
//  - money conversion is only ever parseKwachaToMinor() from @/lib/money
//  - no hard deletes: a BookFormat that has been sold cannot be removed, so
//    "stop selling" is isAvailable = false, never a delete
//  - slug uniqueness is the schema's job; a P2002 becomes a friendly field error

// --- input shape ----------------------------------------------------------
// Raw, form-ish values. The service does all parsing so the action stays thin
// and every failure comes back as a field issue the form renders inline.

export type FormatDraft = {
  /** Sell this format? Also stored as isAvailable. */
  available: boolean;
  /** Kwacha as typed. Required whenever a row exists or is being created. */
  price: string;
  /** PRINT only. Blank = not tracked (stored NULL). */
  stockOnHand: string;
};

export type BookDraft = {
  title: string;
  subtitle: string;
  categoryLine: string;
  authorCredit: string;
  description: string;
  /** Blank ⇒ derived from the title. */
  slug: string;
  sortOrder: string;
  published: boolean;
  print: FormatDraft;
  ebook: FormatDraft;
};

/** Flat: keys match form field names and Zod issue paths one-to-one. */
export type FieldIssues = Record<string, string>;

export type BookWriteResult =
  | { ok: true; id: string }
  | { ok: false; error: "invalid_input"; issues: FieldIssues }
  | { ok: false; error: "slug_taken" }
  | { ok: false; error: "not_found" };

export type BookWithFormats = Book & { formats: BookFormat[] };

const MAX_SORT_ORDER = 9999;

// --- schema -------------------------------------------------------------

type ValidFormat = {
  /** Should there be a BookFormat row at all? */
  present: boolean;
  priceMinor: number;
  isAvailable: boolean;
  stockOnHand: number | null;
};

type ValidBook = {
  data: {
    title: string;
    subtitle: string | null;
    categoryLine: string | null;
    authorCredit: string;
    description: string;
    slug: string;
    sortOrder: number;
    published: boolean;
  };
  print: ValidFormat;
  ebook: ValidFormat;
};

function checkFormat(
  raw: FormatDraft,
  opts: { isPrint: boolean; rowExists: boolean; priceKey: string; stockKey: string },
  ctx: z.RefinementCtx,
): ValidFormat {
  const priceGiven = raw.price.trim() !== "";
  const present = opts.rowExists || priceGiven || raw.available;

  let priceMinor = 0;
  if (present && !priceGiven) {
    ctx.addIssue({
      code: "custom",
      path: [opts.priceKey],
      message: opts.rowExists
        ? "A format needs a price. Untick “Available” to pause it instead."
        : "Enter a price for this format.",
    });
  } else if (present) {
    const parsed = parseKwachaToMinor(raw.price);
    if (!parsed.ok) {
      ctx.addIssue({ code: "custom", path: [opts.priceKey], message: parsed.error });
    } else {
      priceMinor = parsed.minor;
    }
  }

  let stockOnHand: number | null = null;
  if (opts.isPrint && raw.stockOnHand.trim() !== "") {
    const n = Number(raw.stockOnHand.trim());
    if (!Number.isInteger(n) || n < 0) {
      ctx.addIssue({
        code: "custom",
        path: [opts.stockKey],
        message: "Stock must be a whole number, zero or more.",
      });
    } else {
      stockOnHand = n;
    }
  }

  return { present, priceMinor, isAvailable: raw.available, stockOnHand };
}

function bookSchema(rows: { print: boolean; ebook: boolean }) {
  const formatShape = z.object({
    available: z.boolean(),
    price: z.string(),
    stockOnHand: z.string(),
  });

  return z
    .object({
      title: z
        .string()
        .trim()
        .min(1, "Enter a title.")
        .max(200, "That title is too long."),
      subtitle: z.string().trim().max(200, "That subtitle is too long."),
      categoryLine: z.string().trim().max(120, "That category line is too long."),
      authorCredit: z
        .string()
        .trim()
        .min(1, "Enter the author credit exactly as printed on this book's cover.")
        .max(200, "That author credit is too long."),
      description: z
        .string()
        .trim()
        .min(1, "Enter a description.")
        .max(5000, "That description is too long."),
      slug: z.string().trim(),
      sortOrder: z.string().trim(),
      published: z.boolean(),
      print: formatShape,
      ebook: formatShape,
    })
    .transform((v, ctx): ValidBook => {
      const slug = v.slug ? slugify(v.slug) : slugify(v.title);
      if (!slug) {
        ctx.addIssue({
          code: "custom",
          path: ["slug"],
          message: "Enter a slug (letters and numbers).",
        });
      } else if (!/^[a-z0-9-]+$/.test(slug)) {
        ctx.addIssue({
          code: "custom",
          path: ["slug"],
          message: "Use lowercase letters, numbers and hyphens only.",
        });
      }

      let sortOrder = 0;
      if (v.sortOrder !== "") {
        const n = Number(v.sortOrder);
        if (!Number.isInteger(n) || n < 0 || n > MAX_SORT_ORDER) {
          ctx.addIssue({
            code: "custom",
            path: ["sortOrder"],
            message: `Sort order must be a whole number between 0 and ${MAX_SORT_ORDER}.`,
          });
        } else {
          sortOrder = n;
        }
      }

      const print = checkFormat(
        v.print,
        { isPrint: true, rowExists: rows.print, priceKey: "printPrice", stockKey: "printStock" },
        ctx,
      );
      const ebook = checkFormat(
        v.ebook,
        { isPrint: false, rowExists: rows.ebook, priceKey: "ebookPrice", stockKey: "ebookStock" },
        ctx,
      );

      return {
        data: {
          title: v.title,
          subtitle: v.subtitle || null,
          categoryLine: v.categoryLine || null,
          authorCredit: v.authorCredit,
          description: v.description,
          slug,
          sortOrder,
          published: v.published,
        },
        print,
        ebook,
      };
    });
}

function flattenIssues(error: z.ZodError): FieldIssues {
  const issues: FieldIssues = {};
  for (const issue of error.issues) {
    const key = issue.path.map(String).join(".");
    if (key && !(key in issues)) issues[key] = issue.message;
  }
  return issues;
}

// --- helpers -----------------------------------------------------------

function isSlugCollision(error: unknown): boolean {
  return isUniqueViolationOn(error, "slug");
}

function formatCreateData(type: BookFormatType, v: ValidFormat) {
  return {
    type,
    priceMinor: v.priceMinor,
    isAvailable: v.isAvailable,
    stockOnHand: type === "PRINT" ? v.stockOnHand : null,
  };
}

// --- reads -----------------------------------------------------------

export function listBooksForAdmin(): Promise<BookWithFormats[]> {
  return db.book.findMany({
    include: { formats: true },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  });
}

export function getBookForAdmin(id: string): Promise<BookWithFormats | null> {
  return db.book.findUnique({ where: { id }, include: { formats: true } });
}

/** Public catalogue: published books only, in the author's chosen order. */
export function listPublishedBooks(): Promise<BookWithFormats[]> {
  return db.book.findMany({
    where: { published: true },
    include: { formats: true },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  });
}

/**
 * Public detail page. Returns null for an unknown slug OR a draft — a draft
 * must not be reachable by guessing the URL.
 */
export function getPublishedBookBySlug(
  slug: string,
): Promise<BookWithFormats | null> {
  return db.book.findFirst({
    where: { slug, published: true },
    include: { formats: true },
  });
}

/** Formats a buyer can currently choose. Availability is `isAvailable`; stock
 *  (a PRINT format at 0) is a separate signal the detail page handles. */
export function availableFormats(book: BookWithFormats): BookFormat[] {
  return book.formats.filter((f) => f.isAvailable);
}

/** The lowest available format, for the catalogue "from …" price. Null when a
 *  published book has nothing for sale yet. */
export function cheapestAvailableFormat(book: BookWithFormats): BookFormat | null {
  return availableFormats(book).reduce<BookFormat | null>(
    (lowest, f) => (lowest === null || f.priceMinor < lowest.priceMinor ? f : lowest),
    null,
  );
}

export type PurchasableFormat = BookFormat & { book: Book };

/**
 * Checkout lookup. Null when the format is unknown, unavailable, or its book is
 * unpublished — those all 404 the checkout page. Stock is NOT checked here: it
 * can change between page load and submit, and createOrder() is the real gate.
 */
export async function getPurchasableBookFormat(
  id: string,
): Promise<PurchasableFormat | null> {
  const format = await db.bookFormat.findUnique({
    where: { id },
    include: { book: true },
  });
  if (!format || !format.isAvailable || !format.book.published) return null;
  return format;
}

// --- writes --------------------------------------------------------

export async function createBook(draft: BookDraft): Promise<BookWriteResult> {
  const parsed = bookSchema({ print: false, ebook: false }).safeParse(draft);
  if (!parsed.success) {
    return { ok: false, error: "invalid_input", issues: flattenIssues(parsed.error) };
  }
  const { data, print, ebook } = parsed.data;

  const formats = [
    print.present ? formatCreateData("PRINT", print) : null,
    ebook.present ? formatCreateData("EBOOK", ebook) : null,
  ].filter((f): f is NonNullable<typeof f> => f !== null);

  try {
    const book = await db.book.create({
      data: { ...data, formats: { create: formats } },
    });
    return { ok: true, id: book.id };
  } catch (error) {
    if (isSlugCollision(error)) return { ok: false, error: "slug_taken" };
    throw error;
  }
}

export async function updateBook(
  id: string,
  draft: BookDraft,
): Promise<BookWriteResult> {
  const existing = await db.book.findUnique({
    where: { id },
    include: { formats: true },
  });
  if (!existing) return { ok: false, error: "not_found" };

  const rows = {
    print: existing.formats.some((f) => f.type === "PRINT"),
    ebook: existing.formats.some((f) => f.type === "EBOOK"),
  };

  const parsed = bookSchema(rows).safeParse(draft);
  if (!parsed.success) {
    return { ok: false, error: "invalid_input", issues: flattenIssues(parsed.error) };
  }
  const { data, print, ebook } = parsed.data;

  try {
    await db.$transaction(async (tx) => {
      await tx.book.update({ where: { id }, data });

      for (const [type, v] of [
        ["PRINT", print],
        ["EBOOK", ebook],
      ] as const) {
        if (!v.present) continue;
        await tx.bookFormat.upsert({
          where: { bookId_type: { bookId: id, type } },
          create: { bookId: id, ...formatCreateData(type, v) },
          update: {
            priceMinor: v.priceMinor,
            isAvailable: v.isAvailable,
            stockOnHand: type === "PRINT" ? v.stockOnHand : null,
          },
        });
        // No delete branch: a format that has been sold is protected by
        // OrderItem -> BookFormat onDelete: Restrict. isAvailable = false is
        // the soft toggle.
      }
    });
    return { ok: true, id };
  } catch (error) {
    if (isSlugCollision(error)) return { ok: false, error: "slug_taken" };
    throw error;
  }
}

export async function setBookCover(id: string, coverImageUrl: string): Promise<void> {
  await db.book.update({ where: { id }, data: { coverImageUrl } });
}
