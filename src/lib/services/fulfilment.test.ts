import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { minorToDecimalString } from "@/lib/money";
import { transitionPayment } from "@/lib/payments/transitions";
import { createOrder } from "@/lib/services/orders";
import { submitClaim, type SubmitClaimInput } from "@/lib/services/claims";
import { decideClaim } from "@/lib/services/claim-review";
import {
  fulfilOrderOnConfirm,
  getDownloadInfoForItem,
  regenerateDownloadToken,
  recordSuccessfulDownload,
  resolveDownload,
  revokeActiveDownloadTokensForOrder,
} from "@/lib/services/fulfilment";

// Integration tests against the real .env.test database (CLAUDE.md — a mocked
// Prisma client would let a read-then-write implementation of the guarded
// download-count update pass, which the concurrency test exists to catch).

const EMAIL_DOMAIN = "fulfilment-test.local";
const SLUG_PREFIX = "fulfilment-test-";

let seq = 0;
const txn = () => `TX${Date.now().toString(36)}${(seq++).toString(36)}XYZ`.toUpperCase();

async function makeBook(opts: {
  ebookPriceMinor?: number;
  printPriceMinor?: number;
  ebookAssetUrl?: string;
}) {
  const formats: Array<{
    type: "PRINT" | "EBOOK";
    priceMinor: number;
    isAvailable: boolean;
    ebookAssetUrl?: string;
  }> = [];
  if (opts.ebookPriceMinor != null) {
    formats.push({
      type: "EBOOK",
      priceMinor: opts.ebookPriceMinor,
      isAvailable: true,
      ebookAssetUrl: opts.ebookAssetUrl ?? "https://res.cloudinary.com/test/raw/authenticated/v1/test.pdf",
    });
  }
  if (opts.printPriceMinor != null) {
    formats.push({ type: "PRINT", priceMinor: opts.printPriceMinor, isAvailable: true });
  }
  return db.book.create({
    data: {
      slug: `${SLUG_PREFIX}${crypto.randomUUID()}`,
      title: "Test Book",
      authorCredit: "TEST",
      description: "d",
      published: true,
      formats: { create: formats },
    },
    include: { formats: true },
  });
}

async function makeOrder(opts: { formatId: string; deliveryZone?: "PICKUP" }) {
  const result = await createOrder({
    bookFormatId: opts.formatId,
    quantity: 1,
    customerName: "Test Buyer",
    customerEmail: `c-${crypto.randomUUID()}@${EMAIL_DOMAIN}`,
    customerPhone: "0977123456",
    deliveryZone: opts.deliveryZone,
  });
  if (!result.ok) throw new Error(`order setup failed: ${JSON.stringify(result)}`);
  return result.order;
}

function claimInput(order: { reference: string; accessToken: string }): SubmitClaimInput {
  return {
    orderReference: order.reference,
    accessToken: order.accessToken,
    network: "AIRTEL",
    senderPhone: "0966123456",
    transactionId: txn(),
  };
}

/** Walks an order to CONFIRMED via the real decideClaim flow (exercises the
 *  claim-review.ts -> fulfilment.ts wiring), returns the order id. */
async function confirmViaDecideClaim(orderId: string, totalMinor: number) {
  const order = await db.order.findUniqueOrThrow({ where: { id: orderId } });
  const claimResult = await submitClaim(claimInput(order));
  if (!claimResult.ok) throw new Error("claim setup failed");
  const decided = await decideClaim({
    claimId: claimResult.claim.id,
    matchedAmountKwacha: minorToDecimalString(totalMinor),
    actorId: await makeAdmin(),
  });
  if (!decided.ok) throw new Error(`decide failed: ${JSON.stringify(decided)}`);
}

async function makeAdmin(): Promise<string> {
  const id = crypto.randomUUID();
  await db.user.create({
    data: { id, name: "Test Admin", email: `admin-${id}@${EMAIL_DOMAIN}`, role: "ADMIN" },
  });
  return id;
}

/** A two-item order (EBOOK + PRINT), built directly since createOrder() only
 *  ever creates a single-item order today — same fixture style used
 *  elsewhere for states the public API can't reach directly. */
async function makeMixedOrder(ebookFormatId: string, printFormatId: string) {
  const id = crypto.randomUUID();
  return db.order.create({
    data: {
      reference: `FULTEST-${id.slice(0, 8).toUpperCase()}`,
      accessToken: id,
      customerName: "Test Buyer",
      customerEmail: `mixed-${id}@${EMAIL_DOMAIN}`,
      customerPhone: "0977123456",
      subtotalMinor: 30000,
      totalMinor: 30000,
      paymentExpiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000),
      items: {
        create: [
          {
            bookFormatId: ebookFormatId,
            titleSnapshot: "Test Book",
            formatSnapshot: "EBOOK",
            unitPriceMinor: 15000,
            quantity: 1,
          },
          {
            bookFormatId: printFormatId,
            titleSnapshot: "Test Book",
            formatSnapshot: "PRINT",
            unitPriceMinor: 15000,
            quantity: 1,
          },
        ],
      },
    },
    include: { items: true },
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
  await db.user.deleteMany({ where: { email: { endsWith: `@${EMAIL_DOMAIN}` } } });
}

beforeEach(wipe);
afterAll(async () => {
  await wipe();
  await db.$disconnect();
});

describe("fulfilOrderOnConfirm — ebook order", () => {
  it("via the real decideClaim flow: issues exactly one token and sets DELIVERED_DIGITAL", async () => {
    const book = await makeBook({ ebookPriceMinor: 15000 });
    const order = await makeOrder({ formatId: book.formats[0]!.id });

    await confirmViaDecideClaim(order.id, 15000);

    const tokens = await db.downloadToken.findMany({ where: { orderId: order.id } });
    expect(tokens).toHaveLength(1);
    expect(tokens[0]!.maxDownloads).toBe(5);
    expect(tokens[0]!.downloadCount).toBe(0);
    expect(tokens[0]!.expiresAt.getTime()).toBeGreaterThan(Date.now());

    const item = await db.orderItem.findFirstOrThrow({ where: { orderId: order.id } });
    expect(item.fulfilmentState).toBe("DELIVERED_DIGITAL");

    const events = await db.orderEvent.findMany({
      where: { orderId: order.id, type: "download.issued" },
    });
    expect(events).toHaveLength(1);
  });
});

describe("fulfilOrderOnConfirm — print-only order", () => {
  it("issues no tokens; item goes to AWAITING_PACKING", async () => {
    const book = await makeBook({ printPriceMinor: 15000 });
    const order = await makeOrder({ formatId: book.formats[0]!.id, deliveryZone: "PICKUP" });
    await db.$transaction((tx) => transitionPayment(tx, order.id, "SUBMITTED", { type: "SYSTEM" }));

    await fulfilOrderOnConfirm(order.id);

    const tokens = await db.downloadToken.findMany({ where: { orderId: order.id } });
    expect(tokens).toHaveLength(0);

    const item = await db.orderItem.findFirstOrThrow({ where: { orderId: order.id } });
    expect(item.fulfilmentState).toBe("AWAITING_PACKING");
  });
});

describe("fulfilOrderOnConfirm — mixed order", () => {
  it("issues a token only for the ebook half", async () => {
    const ebookBook = await makeBook({ ebookPriceMinor: 15000 });
    const printBook = await makeBook({ printPriceMinor: 15000 });
    const order = await makeMixedOrder(ebookBook.formats[0]!.id, printBook.formats[0]!.id);
    await db.$transaction((tx) => transitionPayment(tx, order.id, "SUBMITTED", { type: "SYSTEM" }));

    await fulfilOrderOnConfirm(order.id);

    const tokens = await db.downloadToken.findMany({ where: { orderId: order.id } });
    expect(tokens).toHaveLength(1);

    const items = await db.orderItem.findMany({
      where: { orderId: order.id },
      orderBy: { formatSnapshot: "asc" },
    });
    const ebookItem = items.find((i) => i.formatSnapshot === "EBOOK")!;
    const printItem = items.find((i) => i.formatSnapshot === "PRINT")!;
    expect(ebookItem.fulfilmentState).toBe("DELIVERED_DIGITAL");
    expect(printItem.fulfilmentState).toBe("AWAITING_PACKING");
    expect(tokens[0]!.orderItemId).toBe(ebookItem.id);
  });
});

describe("resolveDownload + recordSuccessfulDownload", () => {
  async function makeConfirmedEbookOrder() {
    const book = await makeBook({ ebookPriceMinor: 15000 });
    const order = await makeOrder({ formatId: book.formats[0]!.id });
    await confirmViaDecideClaim(order.id, 15000);
    const token = await db.downloadToken.findFirstOrThrow({ where: { orderId: order.id } });
    return { order, token };
  }

  it("resolves a valid token; recordSuccessfulDownload increments the count and writes a log", async () => {
    const { order, token } = await makeConfirmedEbookOrder();

    const resolved = await resolveDownload(token.token);
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.orderReference).toBe(order.reference);

    const recorded = await recordSuccessfulDownload(resolved.downloadTokenId, resolved.maxDownloads, {
      ip: "203.0.113.5",
      userAgent: "test-agent",
    });
    expect(recorded).toBe(true);

    const fresh = await db.downloadToken.findUniqueOrThrow({ where: { id: token.id } });
    expect(fresh.downloadCount).toBe(1);

    const logs = await db.downloadLog.findMany({ where: { downloadTokenId: token.id } });
    expect(logs).toHaveLength(1);
    expect(logs[0]!.ipAddress).toBe("203.0.113.5");
    expect(logs[0]!.userAgent).toBe("test-agent");
  });

  it("refuses a 6th download attempt", async () => {
    const { token } = await makeConfirmedEbookOrder();

    for (let i = 0; i < 5; i++) {
      const resolved = await resolveDownload(token.token);
      expect(resolved.ok).toBe(true);
      if (!resolved.ok) return;
      const recorded = await recordSuccessfulDownload(resolved.downloadTokenId, resolved.maxDownloads, {
        ip: null,
        userAgent: null,
      });
      expect(recorded).toBe(true);
    }

    const sixth = await resolveDownload(token.token);
    expect(sixth).toMatchObject({ ok: false, error: "limit_reached" });
  });

  it("refuses an expired token", async () => {
    const { token } = await makeConfirmedEbookOrder();
    await db.downloadToken.update({
      where: { id: token.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    const resolved = await resolveDownload(token.token);
    expect(resolved).toMatchObject({ ok: false, error: "expired" });
  });

  it("refuses a revoked token", async () => {
    const { token } = await makeConfirmedEbookOrder();
    await db.downloadToken.update({
      where: { id: token.id },
      data: { revokedAt: new Date() },
    });

    const resolved = await resolveDownload(token.token);
    expect(resolved).toMatchObject({ ok: false, error: "revoked" });
  });

  it("an unknown token is not_found", async () => {
    const resolved = await resolveDownload("does-not-exist");
    expect(resolved).toEqual({ ok: false, error: "not_found" });
  });

  it("concurrency: two simultaneous downloads on the last remaining slot — one succeeds, one refused, one log row", async () => {
    const { token } = await makeConfirmedEbookOrder();
    // Use up 4 of 5 slots first.
    for (let i = 0; i < 4; i++) {
      await db.downloadToken.update({
        where: { id: token.id },
        data: { downloadCount: { increment: 1 } },
      });
    }

    const settled = await Promise.allSettled([
      recordSuccessfulDownload(token.id, 5, { ip: "1.1.1.1", userAgent: "a" }),
      recordSuccessfulDownload(token.id, 5, { ip: "2.2.2.2", userAgent: "b" }),
    ]);
    const results = settled.map((s) => (s.status === "fulfilled" ? s.value : null));
    expect(results.filter((r) => r === true)).toHaveLength(1);
    expect(results.filter((r) => r === false)).toHaveLength(1);

    const fresh = await db.downloadToken.findUniqueOrThrow({ where: { id: token.id } });
    expect(fresh.downloadCount).toBe(5);

    const logs = await db.downloadLog.findMany({ where: { downloadTokenId: token.id } });
    expect(logs).toHaveLength(1);
  });

  it("a token from another order never resolves a different order's asset", async () => {
    const { order: orderA, token: tokenA } = await makeConfirmedEbookOrder();
    const { order: orderB } = await makeConfirmedEbookOrder();

    const resolved = await resolveDownload(tokenA.token);
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.orderReference).toBe(orderA.reference);
    expect(resolved.orderReference).not.toBe(orderB.reference);
  });
});

describe("revokeActiveDownloadTokensForOrder", () => {
  it("revokes every active token for the order and leaves other orders untouched", async () => {
    const bookA = await makeBook({ ebookPriceMinor: 15000 });
    const orderA = await makeOrder({ formatId: bookA.formats[0]!.id });
    await confirmViaDecideClaim(orderA.id, 15000);

    const bookB = await makeBook({ ebookPriceMinor: 15000 });
    const orderB = await makeOrder({ formatId: bookB.formats[0]!.id });
    await confirmViaDecideClaim(orderB.id, 15000);

    await revokeActiveDownloadTokensForOrder(orderA.id, { type: "SYSTEM" });

    const tokensA = await db.downloadToken.findMany({ where: { orderId: orderA.id } });
    expect(tokensA.every((t) => t.revokedAt !== null)).toBe(true);

    const tokensB = await db.downloadToken.findMany({ where: { orderId: orderB.id } });
    expect(tokensB.every((t) => t.revokedAt === null)).toBe(true);

    const events = await db.orderEvent.findMany({
      where: { orderId: orderA.id, type: "download.revoked" },
    });
    expect(events).toHaveLength(1);
  });
});

describe("regenerateDownloadToken + getDownloadInfoForItem", () => {
  it("issues a fresh token for an expired one and it becomes the usable one", async () => {
    const book = await makeBook({ ebookPriceMinor: 15000 });
    const order = await makeOrder({ formatId: book.formats[0]!.id });
    await confirmViaDecideClaim(order.id, 15000);

    const item = await db.orderItem.findFirstOrThrow({ where: { orderId: order.id } });
    const oldToken = await db.downloadToken.findFirstOrThrow({ where: { orderItemId: item.id } });
    await db.downloadToken.update({
      where: { id: oldToken.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    const before = await getDownloadInfoForItem(item.id);
    expect(before?.usable).toBe(false);

    const result = await regenerateDownloadToken({
      orderReference: order.reference,
      accessToken: order.accessToken,
      orderItemId: item.id,
    });
    expect(result.ok).toBe(true);

    const after = await getDownloadInfoForItem(item.id);
    expect(after?.usable).toBe(true);
    if (result.ok) expect(after?.token).toBe(result.token);
  });

  it("refuses a wrong accessToken", async () => {
    const book = await makeBook({ ebookPriceMinor: 15000 });
    const order = await makeOrder({ formatId: book.formats[0]!.id });
    await confirmViaDecideClaim(order.id, 15000);
    const item = await db.orderItem.findFirstOrThrow({ where: { orderId: order.id } });

    const result = await regenerateDownloadToken({
      orderReference: order.reference,
      accessToken: "not-the-token",
      orderItemId: item.id,
    });
    expect(result).toEqual({ ok: false, error: "order_not_found" });
  });

  it("refuses a PRINT item", async () => {
    const book = await makeBook({ printPriceMinor: 15000 });
    const order = await makeOrder({ formatId: book.formats[0]!.id, deliveryZone: "PICKUP" });
    const item = await db.orderItem.findFirstOrThrow({ where: { orderId: order.id } });

    const result = await regenerateDownloadToken({
      orderReference: order.reference,
      accessToken: order.accessToken,
      orderItemId: item.id,
    });
    expect(result).toEqual({ ok: false, error: "item_not_found" });
  });
});
