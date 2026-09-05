import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { minorToDecimalString } from "@/lib/money";
import { transitionPayment } from "@/lib/payments/transitions";
import { createOrder } from "@/lib/services/orders";
import { submitClaim, type SubmitClaimInput } from "@/lib/services/claims";
import { decideClaim } from "@/lib/services/claim-review";
import { advancePrintItem, listPrintQueue } from "@/lib/services/print-fulfilment";

// Integration tests against the real .env.test database (CLAUDE.md — a mocked
// Prisma client would let a read-then-write implementation of the guarded
// state change pass, which the concurrency test exists to catch).

const EMAIL_DOMAIN = "print-fulfilment-test.local";
const SLUG_PREFIX = "print-fulfilment-test-";

let seq = 0;
const txn = () => `TX${Date.now().toString(36)}${(seq++).toString(36)}XYZ`.toUpperCase();

type Zone = "PICKUP" | "LUSAKA" | "REST_OF_ZAMBIA";

async function makeBook(opts: { ebookPriceMinor?: number; printPriceMinor?: number }) {
  const formats: Array<{ type: "PRINT" | "EBOOK"; priceMinor: number; isAvailable: boolean; ebookAssetUrl?: string }> = [];
  if (opts.ebookPriceMinor != null) {
    formats.push({
      type: "EBOOK",
      priceMinor: opts.ebookPriceMinor,
      isAvailable: true,
      ebookAssetUrl: "https://res.cloudinary.com/test/raw/authenticated/v1/test.pdf",
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

async function makeOrder(opts: { formatId: string; zone?: Zone | null }) {
  const zone = opts.zone === undefined ? "PICKUP" : opts.zone;
  const result = await createOrder({
    bookFormatId: opts.formatId,
    quantity: 1,
    customerName: "Test Buyer",
    customerEmail: `c-${crypto.randomUUID()}@${EMAIL_DOMAIN}`,
    customerPhone: "0977123456",
    ...(zone
      ? {
          deliveryZone: zone,
          deliveryAddress: zone === "PICKUP" ? null : "Plot 5, Kabulonga, Lusaka",
        }
      : {}),
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

async function makeAdmin(): Promise<string> {
  const id = crypto.randomUUID();
  await db.user.create({
    data: { id, name: "Test Admin", email: `admin-${id}@${EMAIL_DOMAIN}`, role: "ADMIN" },
  });
  return id;
}

async function confirmOrder(orderId: string) {
  const order = await db.order.findUniqueOrThrow({ where: { id: orderId } });
  const claimResult = await submitClaim(claimInput(order));
  if (!claimResult.ok) throw new Error("claim setup failed");
  const decided = await decideClaim({
    claimId: claimResult.claim.id,
    matchedAmountKwacha: minorToDecimalString(order.totalMinor),
    actorId: await makeAdmin(),
  });
  if (!decided.ok) throw new Error(`decide failed: ${JSON.stringify(decided)}`);
}

async function confirmedPrintItem(zone: Zone = "PICKUP") {
  const book = await makeBook({ printPriceMinor: 15000 });
  const order = await makeOrder({ formatId: book.formats[0]!.id, zone });
  await confirmOrder(order.id);
  const item = await db.orderItem.findFirstOrThrow({ where: { orderId: order.id } });
  return { order, item };
}

async function fulfilmentEvents(orderId: string) {
  return db.orderEvent.findMany({
    where: { orderId, type: { startsWith: "fulfilment." } },
    orderBy: { createdAt: "asc" },
  });
}

async function wipe() {
  await db.order.deleteMany({ where: { customerEmail: { endsWith: `@${EMAIL_DOMAIN}` } } });
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

describe("advancePrintItem — legal transitions", () => {
  it("walks AWAITING_PACKING -> PACKED -> DISPATCHED -> DELIVERED, one event per step", async () => {
    const { order, item } = await confirmedPrintItem();
    const admin = await makeAdmin();

    for (const to of ["PACKED", "DISPATCHED", "DELIVERED"] as const) {
      const r = await advancePrintItem({ orderItemId: item.id, to, actorId: admin });
      expect(r.ok).toBe(true);
    }

    const fresh = await db.orderItem.findUniqueOrThrow({ where: { id: item.id } });
    expect(fresh.fulfilmentState).toBe("DELIVERED");

    const events = await fulfilmentEvents(order.id);
    expect(events.map((e) => e.type)).toEqual([
      "fulfilment.packed",
      "fulfilment.dispatched",
      "fulfilment.delivered",
    ]);
    expect(events[0]!.fromState).toBe("AWAITING_PACKING");
    expect(events[0]!.toState).toBe("PACKED");
    expect(events.every((e) => (e.metadata as { orderItemId?: string }).orderItemId === item.id)).toBe(
      true,
    );
  });

  it("DISPATCHED -> RETURNED is legal", async () => {
    const { item } = await confirmedPrintItem();
    const admin = await makeAdmin();
    await advancePrintItem({ orderItemId: item.id, to: "PACKED", actorId: admin });
    await advancePrintItem({ orderItemId: item.id, to: "DISPATCHED", actorId: admin });

    const r = await advancePrintItem({ orderItemId: item.id, to: "RETURNED", actorId: admin });
    expect(r.ok).toBe(true);
    const fresh = await db.orderItem.findUniqueOrThrow({ where: { id: item.id } });
    expect(fresh.fulfilmentState).toBe("RETURNED");
  });

  it("sets dispatchedAt only on the move to DISPATCHED and trims the tracking note", async () => {
    const { item } = await confirmedPrintItem();
    const admin = await makeAdmin();

    await advancePrintItem({ orderItemId: item.id, to: "PACKED", actorId: admin });
    expect((await db.orderItem.findUniqueOrThrow({ where: { id: item.id } })).dispatchedAt).toBeNull();

    await advancePrintItem({
      orderItemId: item.id,
      to: "DISPATCHED",
      actorId: admin,
      trackingNote: "  Zampost EE123  ",
    });
    const fresh = await db.orderItem.findUniqueOrThrow({ where: { id: item.id } });
    expect(fresh.dispatchedAt).not.toBeNull();
    expect(fresh.trackingNote).toBe("Zampost EE123");
  });
});

describe("advancePrintItem — refusals", () => {
  it("refuses an illegal jump AWAITING_PACKING -> DELIVERED and writes nothing", async () => {
    const { order, item } = await confirmedPrintItem();
    const r = await advancePrintItem({
      orderItemId: item.id,
      to: "DELIVERED",
      actorId: await makeAdmin(),
    });
    expect(r).toEqual({ ok: false, error: "illegal_transition" });

    const fresh = await db.orderItem.findUniqueOrThrow({ where: { id: item.id } });
    expect(fresh.fulfilmentState).toBe("AWAITING_PACKING");
    expect(await fulfilmentEvents(order.id)).toHaveLength(0);
  });

  it("refuses an item whose order is not CONFIRMED", async () => {
    const book = await makeBook({ printPriceMinor: 15000 });
    const order = await makeOrder({ formatId: book.formats[0]!.id });
    await db.$transaction((tx) => transitionPayment(tx, order.id, "SUBMITTED", { type: "SYSTEM" }));

    const item = await db.orderItem.findFirstOrThrow({ where: { orderId: order.id } });
    expect(item.fulfilmentState).toBe("NOT_STARTED");

    // Force the item into a packable state to prove the order-level guard, not
    // the transition table, is what refuses it.
    await db.orderItem.update({
      where: { id: item.id },
      data: { fulfilmentState: "AWAITING_PACKING" },
    });

    const r = await advancePrintItem({
      orderItemId: item.id,
      to: "PACKED",
      actorId: await makeAdmin(),
    });
    expect(r).toEqual({ ok: false, error: "order_not_confirmed" });
    expect(await fulfilmentEvents(order.id)).toHaveLength(0);
  });

  it("not_found for an unknown item id", async () => {
    const r = await advancePrintItem({
      orderItemId: "does-not-exist",
      to: "PACKED",
      actorId: await makeAdmin(),
    });
    expect(r).toEqual({ ok: false, error: "not_found" });
  });

  it("two simultaneous advances: one succeeds, one is refused, exactly one event", async () => {
    const { order, item } = await confirmedPrintItem();
    const admin = await makeAdmin();

    const settled = await Promise.allSettled([
      advancePrintItem({ orderItemId: item.id, to: "PACKED", actorId: admin }),
      advancePrintItem({ orderItemId: item.id, to: "PACKED", actorId: admin }),
    ]);
    // Every call resolves (no throw). Depending on the interleaving the loser
    // either fails the guarded update ("conflict", its read saw AWAITING_PACKING)
    // or the transition table ("illegal_transition", its read saw the committed
    // PACKED) — both mean "someone else got there first".
    expect(settled.every((s) => s.status === "fulfilled")).toBe(true);
    const results = settled.flatMap((s) => (s.status === "fulfilled" ? [s.value] : []));

    expect(results.filter((r) => r.ok === true)).toHaveLength(1);
    expect(
      results.filter((r) => !r.ok && (r.error === "conflict" || r.error === "illegal_transition")),
    ).toHaveLength(1);

    const events = await db.orderEvent.findMany({
      where: { orderId: order.id, type: "fulfilment.packed" },
    });
    expect(events).toHaveLength(1);

    const fresh = await db.orderItem.findUniqueOrThrow({ where: { id: item.id } });
    expect(fresh.fulfilmentState).toBe("PACKED");
  });
});

describe("ebook items are outside the print machine", () => {
  it("a confirmed ebook order never enters the queue and its item cannot advance", async () => {
    const book = await makeBook({ ebookPriceMinor: 15000 });
    const order = await makeOrder({ formatId: book.formats[0]!.id, zone: null });
    await confirmOrder(order.id);

    const queue = await listPrintQueue("AWAITING_PACKING");
    expect(queue.some((r) => r.orderId === order.id)).toBe(false);

    const item = await db.orderItem.findFirstOrThrow({ where: { orderId: order.id } });
    expect(item.fulfilmentState).toBe("DELIVERED_DIGITAL");

    const r = await advancePrintItem({
      orderItemId: item.id,
      to: "PACKED",
      actorId: await makeAdmin(),
    });
    expect(r).toEqual({ ok: false, error: "illegal_transition" });
  });
});

describe("listPrintQueue", () => {
  it("returns PRINT items in the given state with their order attached", async () => {
    const { order, item } = await confirmedPrintItem("LUSAKA");

    const awaiting = await listPrintQueue("AWAITING_PACKING");
    const row = awaiting.find((r) => r.id === item.id);
    expect(row).toBeDefined();
    expect(row!.order.reference).toBe(order.reference);

    await advancePrintItem({ orderItemId: item.id, to: "PACKED", actorId: await makeAdmin() });
    expect((await listPrintQueue("AWAITING_PACKING")).some((r) => r.id === item.id)).toBe(false);
    expect((await listPrintQueue("PACKED")).some((r) => r.id === item.id)).toBe(true);
  });
});
