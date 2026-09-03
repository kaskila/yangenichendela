import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { PaymentState } from "@/generated/prisma/client";
import { transitionPayment } from "@/lib/payments/transitions";
import { createOrder } from "@/lib/services/orders";
import {
  normaliseTransactionId,
  submitClaim,
  type SubmitClaimInput,
} from "@/lib/services/claims";

// Integration tests against the real .env.test database. A mocked client would
// let a read-then-write of paymentState pass — which the concurrency test exists
// to catch.

const EMAIL_DOMAIN = "claims-test.local";
const SLUG_PREFIX = "claims-test-";

let seq = 0;
const txn = () => `TX${Date.now().toString(36)}${(seq++).toString(36)}XYZ`.toUpperCase();

async function makeBook(): Promise<string> {
  const book = await db.book.create({
    data: {
      slug: `${SLUG_PREFIX}${crypto.randomUUID()}`,
      title: "Test Book",
      authorCredit: "TEST",
      description: "d",
      published: true,
      formats: { create: [{ type: "EBOOK", priceMinor: 15000, isAvailable: true }] },
    },
    include: { formats: true },
  });
  return book.formats[0]!.id;
}

async function makeOrder(opts: { email?: string; formatId?: string } = {}) {
  const formatId = opts.formatId ?? (await makeBook());
  const result = await createOrder({
    bookFormatId: formatId,
    quantity: 1,
    customerName: "Test Buyer",
    customerEmail: opts.email ?? `c-${crypto.randomUUID()}@${EMAIL_DOMAIN}`,
    customerPhone: "0977123456",
  });
  if (!result.ok) throw new Error(`order setup failed: ${JSON.stringify(result)}`);
  return result.order;
}

function claimInput(
  order: { reference: string; accessToken: string },
  over: Partial<SubmitClaimInput> = {},
): SubmitClaimInput {
  return {
    orderReference: order.reference,
    accessToken: order.accessToken,
    network: "AIRTEL",
    senderPhone: "0966123456",
    transactionId: txn(),
    ...over,
  };
}

async function walk(orderId: string, ...states: PaymentState[]) {
  for (const state of states) {
    await db.$transaction((tx) =>
      transitionPayment(tx, orderId, state, { type: "ADMIN", id: "test" }),
    );
  }
}

async function wipe() {
  await db.flag.deleteMany({ where: { email: { endsWith: `@${EMAIL_DOMAIN}` } } });
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

beforeEach(wipe);
afterAll(async () => {
  await wipe();
  await db.$disconnect();
});

describe("normaliseTransactionId", () => {
  it("uppercases and strips everything non-alphanumeric", () => {
    expect(normaliseTransactionId(" mp 24.01-abc ")).toBe("MP2401ABC");
    expect(normaliseTransactionId("MP2401ABC")).toBe("MP2401ABC");
    expect(normaliseTransactionId("mp-2401-abc")).toBe("MP2401ABC");
  });
});

describe("submitClaim — a valid claim", () => {
  it("creates the claim and moves the order to SUBMITTED with one event", async () => {
    const order = await makeOrder();
    const result = await submitClaim(claimInput(order, { transactionId: "  abc 123  " }));

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.claim.transactionId).toBe("abc 123"); // raw, trimmed
    expect(result.claim.transactionIdNorm).toBe("ABC123");
    expect(result.claim.status).toBe("PENDING_REVIEW");

    const fresh = await db.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(fresh.paymentState).toBe("SUBMITTED");

    const events = await db.orderEvent.findMany({
      where: { orderId: order.id, type: "payment.submitted" },
    });
    expect(events).toHaveLength(1);
    expect(events[0].actorType).toBe("BUYER");
  });

  it("is accepted from REJECTED and from EXPIRED", async () => {
    const rejected = await makeOrder();
    await walk(rejected.id, "SUBMITTED", "REJECTED");
    expect((await submitClaim(claimInput(rejected))).ok).toBe(true);

    const expired = await makeOrder();
    await walk(expired.id, "EXPIRED");
    expect((await submitClaim(claimInput(expired))).ok).toBe(true);
  });
});

describe("submitClaim — normalisation drives the duplicate constraint", () => {
  it("a spacing/case/punctuation variant on another order is a duplicate", async () => {
    const first = await makeOrder();
    expect((await submitClaim(claimInput(first, { transactionId: "MP2401ABC" }))).ok).toBe(true);

    for (const variant of ["mp2401abc", "MP-2401-ABC", " Mp 2401 Abc "]) {
      const other = await makeOrder();
      const result = await submitClaim(claimInput(other, { transactionId: variant }));
      expect(result).toEqual({ ok: false, error: "duplicate_reference" });
      const fresh = await db.order.findUniqueOrThrow({ where: { id: other.id } });
      expect(fresh.paymentState).toBe("PENDING");
      expect(await db.paymentClaim.count({ where: { orderId: other.id } })).toBe(0);
    }
  });

  it("writes a claim.duplicate_attempt Flag and OrderEvent pointing at the first order", async () => {
    const first = await makeOrder();
    await submitClaim(claimInput(first, { transactionId: "DUPREF001", network: "MTN" }));

    const second = await makeOrder();
    const result = await submitClaim(
      claimInput(second, { transactionId: "dup ref 001", network: "MTN", ip: "1.2.3.4" }),
    );
    expect(result).toEqual({ ok: false, error: "duplicate_reference" });

    const flag = await db.flag.findFirstOrThrow({
      where: { type: "claim.duplicate_attempt", orderId: second.id },
    });
    expect(flag.relatedOrderId).toBe(first.id);
    expect(flag.ipAddress).toBe("1.2.3.4");

    const events = await db.orderEvent.findMany({
      where: { orderId: second.id, type: "claim.duplicate_attempt" },
    });
    expect(events).toHaveLength(1);
    expect(events[0].actorType).toBe("BUYER");
  });
});

describe("submitClaim — state gate", () => {
  it.each(["CONFIRMED", "CANCELLED"] as const)(
    "refuses a claim for a %s order",
    async (target) => {
      const order = await makeOrder();
      if (target === "CONFIRMED") await walk(order.id, "SUBMITTED", "CONFIRMED");
      else await walk(order.id, "CANCELLED");

      const result = await submitClaim(claimInput(order));
      expect(result).toEqual({ ok: false, error: "not_awaiting_payment" });
      expect(await db.paymentClaim.count({ where: { orderId: order.id } })).toBe(0);
    },
  );
});

describe("submitClaim — wrong access token", () => {
  it("is refused as order_not_found and changes nothing", async () => {
    const order = await makeOrder();
    const result = await submitClaim(
      claimInput(order, { accessToken: "not-the-token" }),
    );
    expect(result).toEqual({ ok: false, error: "order_not_found" });
    expect(await db.paymentClaim.count({ where: { orderId: order.id } })).toBe(0);
    const fresh = await db.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(fresh.paymentState).toBe("PENDING");
  });
});

describe("submitClaim — reference length (no format regex)", () => {
  it.each([
    ["AB123", false], // 5 normalised
    ["A".repeat(31), false],
    ["ABC123", true], // 6
    ["A".repeat(30), true],
  ])("%s -> accepted=%s", async (ref, accepted) => {
    const order = await makeOrder();
    const result = await submitClaim(claimInput(order, { transactionId: ref }));
    if (accepted) {
      expect(result.ok).toBe(true);
    } else {
      expect(result.ok).toBe(false);
      if (result.ok || result.error !== "invalid_input") throw new Error("expected invalid_input");
      expect(result.issues.transactionId).toBeDefined();
    }
  });
});

describe("submitClaim — concurrency", () => {
  it("two simultaneous submissions: one wins, one refused, one claim, one event", async () => {
    const order = await makeOrder();

    const [a, b] = await Promise.all([
      submitClaim(claimInput(order, { transactionId: txn() })),
      submitClaim(claimInput(order, { transactionId: txn() })),
    ]);

    const oks = [a, b].filter((r) => r.ok);
    const refused = [a, b].filter((r) => !r.ok);
    expect(oks).toHaveLength(1);
    expect(refused).toHaveLength(1);
    expect(refused[0]).toMatchObject({ ok: false, error: "not_awaiting_payment" });

    expect(await db.paymentClaim.count({ where: { orderId: order.id } })).toBe(1);
    expect(
      await db.orderEvent.count({
        where: { orderId: order.id, type: "payment.submitted" },
      }),
    ).toBe(1);
    const fresh = await db.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(fresh.paymentState).toBe("SUBMITTED");
  });
});

describe("submitClaim — rate limits", () => {
  it("refuses a 4th claim on one order and flags it", async () => {
    const order = await makeOrder();
    for (let i = 0; i < 3; i++) {
      const r = await submitClaim(claimInput(order, { transactionId: txn() }));
      expect(r.ok).toBe(true);
      await walk(order.id, "REJECTED"); // SUBMITTED -> REJECTED so the next is claim-legal
    }
    const fourth = await submitClaim(claimInput(order, { transactionId: txn() }));
    expect(fourth).toEqual({ ok: false, error: "rate_limited", scope: "order" });
    expect(
      await db.flag.count({ where: { orderId: order.id, type: "ratelimit.hit" } }),
    ).toBe(1);
  });

  it("refuses a 6th claim from one email within the hour", async () => {
    const email = `bulk-${crypto.randomUUID()}@${EMAIL_DOMAIN}`;
    const formatId = await makeBook();
    for (let i = 0; i < 5; i++) {
      const o = await makeOrder({ email, formatId });
      const r = await submitClaim(claimInput(o, { transactionId: txn() }));
      expect(r.ok).toBe(true);
    }
    const sixth = await makeOrder({ email, formatId });
    const result = await submitClaim(claimInput(sixth, { transactionId: txn() }));
    expect(result).toEqual({ ok: false, error: "rate_limited", scope: "email" });
  });

  it("refuses an 11th claim from one IP within the hour", async () => {
    const ip = "203.0.113.55";
    const formatId = await makeBook();
    for (let i = 0; i < 10; i++) {
      const o = await makeOrder({ formatId }); // distinct email each time
      const r = await submitClaim(claimInput(o, { transactionId: txn(), ip }));
      expect(r.ok).toBe(true);
    }
    const o11 = await makeOrder({ formatId });
    const result = await submitClaim(claimInput(o11, { transactionId: txn(), ip }));
    expect(result).toEqual({ ok: false, error: "rate_limited", scope: "ip" });
  });
});
