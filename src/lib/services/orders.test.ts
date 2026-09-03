import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import {
  REFERENCE_PATTERN,
  createOrder,
  getOrderByAccessToken,
  getOrderByReference,
  type CreateOrderInput,
} from "@/lib/services/orders";

// Integration tests against the real .env.test Postgres database (CLAUDE.md: a
// mocked client would let a read-then-write price lookup pass). The rule this
// file exists to protect: the order total is computed from the STORED
// priceMinor, never a value from the caller.

const EMAIL_DOMAIN = "order-test.local";
const SLUG_PREFIX = "orders-test-";

type MakeBookOpts = {
  published?: boolean;
  printPriceMinor?: number | null;
  printStock?: number | null;
  printAvailable?: boolean;
  ebookPriceMinor?: number | null;
  ebookAvailable?: boolean;
};

async function makeBook(opts: MakeBookOpts) {
  const formats: Array<{
    type: "PRINT" | "EBOOK";
    priceMinor: number;
    isAvailable: boolean;
    stockOnHand: number | null;
  }> = [];
  if (opts.printPriceMinor != null) {
    formats.push({
      type: "PRINT",
      priceMinor: opts.printPriceMinor,
      isAvailable: opts.printAvailable ?? true,
      stockOnHand: opts.printStock ?? null,
    });
  }
  if (opts.ebookPriceMinor != null) {
    formats.push({
      type: "EBOOK",
      priceMinor: opts.ebookPriceMinor,
      isAvailable: opts.ebookAvailable ?? true,
      stockOnHand: null,
    });
  }
  return db.book.create({
    data: {
      slug: `${SLUG_PREFIX}${crypto.randomUUID()}`,
      title: "Test Book",
      authorCredit: "TEST AUTHOR",
      description: "A test book.",
      published: opts.published ?? true,
      formats: { create: formats },
    },
    include: { formats: true },
  });
}

async function formatId(book: Awaited<ReturnType<typeof makeBook>>, type: "PRINT" | "EBOOK") {
  const f = book.formats.find((x) => x.type === type);
  if (!f) throw new Error(`test book has no ${type} format`);
  return f.id;
}

function baseInput(
  over: Partial<CreateOrderInput> & { bookFormatId: string },
): CreateOrderInput {
  return {
    quantity: 1,
    customerName: "Test Buyer",
    customerEmail: `b-${crypto.randomUUID()}@${EMAIL_DOMAIN}`,
    customerPhone: "0977123456",
    ...over,
  };
}

async function setLusakaFee(minor: number) {
  await db.storeSettings.upsert({
    where: { id: "singleton" },
    create: { deliveryLusakaMinor: minor },
    update: { deliveryLusakaMinor: minor },
  });
}

async function wipe() {
  await db.order.deleteMany({
    where: { customerEmail: { endsWith: `@${EMAIL_DOMAIN}` } },
  });
  const books = await db.book.findMany({
    where: { slug: { startsWith: SLUG_PREFIX } },
    select: { id: true },
  });
  const ids = books.map((b) => b.id);
  await db.bookFormat.deleteMany({ where: { bookId: { in: ids } } });
  await db.book.deleteMany({ where: { id: { in: ids } } });
}

beforeEach(async () => {
  await wipe();
  await setLusakaFee(5000);
});

afterAll(async () => {
  await wipe();
  await setLusakaFee(5000);
  await db.$disconnect();
});

describe("createOrder — the price is never taken from the caller", () => {
  it("ignores a smuggled price and uses the stored priceMinor", async () => {
    const book = await makeBook({ ebookPriceMinor: 25000 });
    const input = {
      ...baseInput({ bookFormatId: await formatId(book, "EBOOK"), quantity: 2 }),
      // fields that do not exist on CreateOrderInput — an attacker's payload
      priceMinor: 1,
      unitPriceMinor: 1,
      totalMinor: 1,
    } as unknown as CreateOrderInput;

    const result = await createOrder(input);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.order.subtotalMinor).toBe(50000);
    expect(result.order.totalMinor).toBe(50000);
    expect(result.order.items).toHaveLength(1);
    expect(result.order.items[0].unitPriceMinor).toBe(25000);
    expect(result.order.items[0].titleSnapshot).toBe("Test Book");
    expect(result.order.items[0].formatSnapshot).toBe("EBOOK");
  });
});

describe("createOrder — delivery", () => {
  it("ebook: no delivery zone, no fee", async () => {
    const book = await makeBook({ ebookPriceMinor: 12000 });
    const result = await createOrder(
      baseInput({ bookFormatId: await formatId(book, "EBOOK") }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.order.deliveryZone).toBeNull();
    expect(result.order.deliveryAddress).toBeNull();
    expect(result.order.deliveryMinor).toBe(0);
    expect(result.order.totalMinor).toBe(result.order.subtotalMinor);
  });

  it("Lusaka print: adds the configured delivery fee", async () => {
    await setLusakaFee(7500);
    const book = await makeBook({ printPriceMinor: 30000 });
    const result = await createOrder(
      baseInput({
        bookFormatId: await formatId(book, "PRINT"),
        deliveryZone: "LUSAKA",
        deliveryAddress: "1 Test Road, Lusaka",
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.order.deliveryMinor).toBe(7500);
    expect(result.order.subtotalMinor).toBe(30000);
    expect(result.order.totalMinor).toBe(37500);
    expect(result.order.deliveryAddress).toBe("1 Test Road, Lusaka");
  });

  it("rest of Zambia print: no fee, address kept", async () => {
    const book = await makeBook({ printPriceMinor: 30000 });
    const result = await createOrder(
      baseInput({
        bookFormatId: await formatId(book, "PRINT"),
        deliveryZone: "REST_OF_ZAMBIA",
        deliveryAddress: "Plot 5, Kitwe",
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.order.deliveryMinor).toBe(0);
    expect(result.order.totalMinor).toBe(30000);
    expect(result.order.deliveryAddress).toBe("Plot 5, Kitwe");
  });

  it("pickup print: no fee, address NOT stored even if supplied", async () => {
    const book = await makeBook({ printPriceMinor: 30000 });
    const result = await createOrder(
      baseInput({
        bookFormatId: await formatId(book, "PRINT"),
        deliveryZone: "PICKUP",
        deliveryAddress: "should be ignored",
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.order.deliveryZone).toBe("PICKUP");
    expect(result.order.deliveryAddress).toBeNull();
    expect(result.order.deliveryMinor).toBe(0);
  });

  it("print without a zone is refused", async () => {
    const book = await makeBook({ printPriceMinor: 30000 });
    const result = await createOrder(
      baseInput({ bookFormatId: await formatId(book, "PRINT") }),
    );
    expect(result).toEqual({ ok: false, error: "delivery_zone_required" });
  });

  it("Lusaka print without an address is refused", async () => {
    const book = await makeBook({ printPriceMinor: 30000 });
    const result = await createOrder(
      baseInput({
        bookFormatId: await formatId(book, "PRINT"),
        deliveryZone: "LUSAKA",
      }),
    );
    expect(result).toEqual({ ok: false, error: "delivery_address_required" });
  });

  it("ebook with a delivery zone is refused (tampering signal)", async () => {
    const book = await makeBook({ ebookPriceMinor: 12000 });
    const result = await createOrder(
      baseInput({
        bookFormatId: await formatId(book, "EBOOK"),
        deliveryZone: "LUSAKA",
        deliveryAddress: "1 Test Road",
      }),
    );
    expect(result).toEqual({ ok: false, error: "delivery_not_applicable" });
  });
});

describe("createOrder — availability", () => {
  it("refuses an unavailable format", async () => {
    const book = await makeBook({ ebookPriceMinor: 12000, ebookAvailable: false });
    const input = baseInput({ bookFormatId: await formatId(book, "EBOOK") });
    const result = await createOrder(input);
    expect(result).toEqual({ ok: false, error: "format_unavailable" });
    expect(await db.order.count({ where: { customerEmail: input.customerEmail } })).toBe(0);
  });

  it("refuses a format on an unpublished book", async () => {
    const book = await makeBook({ ebookPriceMinor: 12000, published: false });
    const result = await createOrder(
      baseInput({ bookFormatId: await formatId(book, "EBOOK") }),
    );
    expect(result).toEqual({ ok: false, error: "format_unavailable" });
  });

  it("refuses a print format with zero stock", async () => {
    const book = await makeBook({ printPriceMinor: 30000, printStock: 0 });
    const result = await createOrder(
      baseInput({
        bookFormatId: await formatId(book, "PRINT"),
        deliveryZone: "PICKUP",
      }),
    );
    expect(result).toEqual({ ok: false, error: "out_of_stock" });
  });

  it("refuses a print order for more than the stock on hand", async () => {
    const book = await makeBook({ printPriceMinor: 30000, printStock: 2 });
    const result = await createOrder(
      baseInput({
        bookFormatId: await formatId(book, "PRINT"),
        quantity: 5,
        deliveryZone: "PICKUP",
      }),
    );
    expect(result).toEqual({ ok: false, error: "out_of_stock" });
  });

  it("refuses an unknown format id", async () => {
    const result = await createOrder(baseInput({ bookFormatId: "no-such-format" }));
    expect(result).toEqual({ ok: false, error: "format_not_found" });
  });
});

describe("createOrder — snapshots (Rule 7)", () => {
  it("a later price change does not move an existing order's total", async () => {
    const book = await makeBook({ ebookPriceMinor: 20000 });
    const fmtId = await formatId(book, "EBOOK");
    const result = await createOrder(baseInput({ bookFormatId: fmtId, quantity: 2 }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    await db.bookFormat.update({ where: { id: fmtId }, data: { priceMinor: 99999 } });

    const reread = await getOrderByReference(result.order.reference);
    expect(reread?.totalMinor).toBe(40000);
    expect(reread?.items[0].unitPriceMinor).toBe(20000);
    expect(reread?.items[0].titleSnapshot).toBe("Test Book");
  });
});

describe("createOrder — audit + tokens", () => {
  it("writes exactly one order.created OrderEvent by the BUYER", async () => {
    const book = await makeBook({ ebookPriceMinor: 12000 });
    const result = await createOrder(
      baseInput({ bookFormatId: await formatId(book, "EBOOK") }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const events = await db.orderEvent.findMany({
      where: { orderId: result.order.id, type: "order.created" },
    });
    expect(events).toHaveLength(1);
    expect(events[0].actorType).toBe("BUYER");
  });

  it("reference and accessToken are unique across many orders", async () => {
    const book = await makeBook({ ebookPriceMinor: 5000 });
    const fmtId = await formatId(book, "EBOOK");

    const refs = new Set<string>();
    const tokens = new Set<string>();
    for (let i = 0; i < 30; i++) {
      const result = await createOrder(baseInput({ bookFormatId: fmtId }));
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.order.reference).toMatch(REFERENCE_PATTERN);
      refs.add(result.order.reference);
      tokens.add(result.order.accessToken);
    }
    expect(refs.size).toBe(30);
    expect(tokens.size).toBe(30);
  });

  it("getOrderByReference is case-insensitive; getOrderByAccessToken is exact", async () => {
    const book = await makeBook({ ebookPriceMinor: 5000 });
    const result = await createOrder(
      baseInput({ bookFormatId: await formatId(book, "EBOOK") }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const byRef = await getOrderByReference(result.order.reference.toLowerCase());
    expect(byRef?.id).toBe(result.order.id);

    const byToken = await getOrderByAccessToken(result.order.accessToken);
    expect(byToken?.id).toBe(result.order.id);
    expect(await getOrderByAccessToken("wrong")).toBeNull();
  });
});

describe("createOrder — rate limiting", () => {
  it("caps order creation per IP and lets a different IP through", async () => {
    const book = await makeBook({ ebookPriceMinor: 5000 });
    const fmtId = await formatId(book, "EBOOK");
    const ip = "203.0.113.7";

    for (let i = 0; i < 10; i++) {
      const ok = await createOrder(baseInput({ bookFormatId: fmtId, creationIp: ip }));
      expect(ok.ok).toBe(true);
    }
    const blocked = await createOrder(baseInput({ bookFormatId: fmtId, creationIp: ip }));
    expect(blocked).toEqual({ ok: false, error: "rate_limited" });

    const other = await createOrder(
      baseInput({ bookFormatId: fmtId, creationIp: "203.0.113.8" }),
    );
    expect(other.ok).toBe(true);
  });
});

describe("createOrder — input validation", () => {
  it.each([
    [{ quantity: 0 }, "quantity"],
    [{ quantity: 11 }, "quantity"],
    [{ customerEmail: "not-an-email" }, "customerEmail"],
  ])("rejects %o with a field issue on %s", async (over, key) => {
    const book = await makeBook({ ebookPriceMinor: 5000 });
    const result = await createOrder(
      baseInput({ bookFormatId: await formatId(book, "EBOOK"), ...over }),
    );
    expect(result.ok).toBe(false);
    if (result.ok || result.error !== "invalid_input") throw new Error("expected invalid_input");
    expect(result.issues[key]).toBeDefined();
  });
});
