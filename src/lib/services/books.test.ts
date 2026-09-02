import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import {
  createBook,
  getBookForAdmin,
  updateBook,
  type BookDraft,
} from "@/lib/services/books";

// Integration tests against the real .env.test Postgres database (CLAUDE.md:
// a mocked Prisma client would let a broken read-then-write pass). These guard
// the two rules that hurt most in production if they regress: exact money
// conversion, and "no hard delete on anything sold".

const SLUG_PREFIX = "books-test-";

function draft(over: Partial<BookDraft> = {}): BookDraft {
  return {
    title: "Level Up",
    subtitle: "and unlock your Fate",
    categoryLine: "Inspiration & Leadership",
    authorCredit: "CHENDELA YANGENI",
    description: "A book about levelling up.",
    slug: `${SLUG_PREFIX}level-up`,
    sortOrder: "1",
    published: false,
    print: { available: true, price: "250.10", stockOnHand: "50" },
    ebook: { available: true, price: "120.00", stockOnHand: "" },
    ...over,
  };
}

async function wipe() {
  const books = await db.book.findMany({
    where: { slug: { startsWith: SLUG_PREFIX } },
    select: { id: true },
  });
  const ids = books.map((b) => b.id);
  await db.bookFormat.deleteMany({ where: { bookId: { in: ids } } });
  await db.book.deleteMany({ where: { id: { in: ids } } });
}

beforeEach(wipe);
afterAll(async () => {
  await wipe();
  await db.$disconnect();
});

describe("createBook", () => {
  it("stores prices as exact integer ngwee (250.10 -> 25010)", async () => {
    const created = await createBook(draft());
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const book = await getBookForAdmin(created.id);
    const print = book!.formats.find((f) => f.type === "PRINT")!;
    const ebook = book!.formats.find((f) => f.type === "EBOOK")!;
    expect(print.priceMinor).toBe(25010);
    expect(print.stockOnHand).toBe(50);
    expect(ebook.priceMinor).toBe(12000);
    expect(ebook.stockOnHand).toBeNull();
  });

  it("derives the slug from the title when the field is blank", async () => {
    // Title carries the SLUG_PREFIX so the derived slug is still swept by wipe().
    const created = await createBook(
      draft({ slug: "", title: `${SLUG_PREFIX}Derived From Title` }),
    );
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const book = await getBookForAdmin(created.id);
    expect(book!.slug).toBe(`${SLUG_PREFIX}derived-from-title`);
  });

  it("returns slug_taken (not a raw P2002) on a duplicate slug", async () => {
    const first = await createBook(draft());
    expect(first.ok).toBe(true);
    const second = await createBook(draft({ title: "Another book" }));
    expect(second).toEqual({ ok: false, error: "slug_taken" });
  });

  it.each([
    ["10.999", /2 decimal places/],
    ["-5", /sign/],
    ["abc", /kwacha/],
  ])("rejects the price %j with a field issue", async (price, pattern) => {
    const result = await createBook(
      draft({ print: { available: true, price, stockOnHand: "" } }),
    );
    expect(result.ok).toBe(false);
    if (result.ok || result.error !== "invalid_input") throw new Error("expected invalid_input");
    expect(result.issues.printPrice).toMatch(pattern);
    expect(await db.book.count({ where: { slug: { startsWith: SLUG_PREFIX } } })).toBe(0);
  });

  it("requires an author credit", async () => {
    const result = await createBook(draft({ authorCredit: "  " }));
    expect(result.ok).toBe(false);
    if (result.ok || result.error !== "invalid_input") throw new Error("expected invalid_input");
    expect(result.issues.authorCredit).toBeDefined();
  });

  it("creates only the formats that are offered", async () => {
    const created = await createBook(
      draft({ ebook: { available: false, price: "", stockOnHand: "" } }),
    );
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const book = await getBookForAdmin(created.id);
    expect(book!.formats.map((f) => f.type)).toEqual(["PRINT"]);
  });
});

describe("updateBook", () => {
  it("pauses a format by unticking Available — it is never deleted", async () => {
    const created = await createBook(draft());
    if (!created.ok) throw new Error("setup failed");

    const updated = await updateBook(
      created.id,
      draft({
        print: { available: false, price: "250.10", stockOnHand: "40" },
        ebook: { available: true, price: "130.50", stockOnHand: "" },
      }),
    );
    expect(updated.ok).toBe(true);

    const book = await getBookForAdmin(created.id);
    const print = book!.formats.find((f) => f.type === "PRINT")!;
    expect(print.isAvailable).toBe(false); // paused, still present
    expect(print.stockOnHand).toBe(40);
    expect(book!.formats.find((f) => f.type === "EBOOK")!.priceMinor).toBe(13050);
  });

  it("refuses to clear the price of an existing format", async () => {
    const created = await createBook(draft());
    if (!created.ok) throw new Error("setup failed");

    const result = await updateBook(
      created.id,
      draft({ print: { available: true, price: "", stockOnHand: "" } }),
    );
    expect(result.ok).toBe(false);
    if (result.ok || result.error !== "invalid_input") throw new Error("expected invalid_input");
    expect(result.issues.printPrice).toMatch(/needs a price/);
  });

  it("returns not_found for an unknown id", async () => {
    expect(await updateBook("nope", draft())).toEqual({ ok: false, error: "not_found" });
  });
});
