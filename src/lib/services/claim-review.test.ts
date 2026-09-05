import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { PaymentTransitionError, transitionPayment } from "@/lib/payments/transitions";
import { createOrder } from "@/lib/services/orders";
import { submitClaim, type SubmitClaimInput } from "@/lib/services/claims";
import {
  decideClaim,
  rejectClaim,
  reopenOrder,
  type DecideClaimResult,
} from "@/lib/services/claim-review";

// Integration tests against the real .env.test database (CLAUDE.md — a mocked
// Prisma client would let a read-then-write implementation pass, which the
// concurrency test exists to catch).

const EMAIL_DOMAIN = "claim-review-test.local";
const SLUG_PREFIX = "claim-review-test-";

// reviewedById is a real foreign key to User, so the reviewing admin has to be
// a real row — created fresh per test in beforeEach.
let ADMIN_ID: string;

async function makeAdmin(): Promise<string> {
  const id = crypto.randomUUID();
  await db.user.create({
    data: { id, name: "Test Admin", email: `admin-${id}@${EMAIL_DOMAIN}`, role: "ADMIN" },
  });
  return id;
}

let seq = 0;
const txn = () => `TX${Date.now().toString(36)}${(seq++).toString(36)}XYZ`.toUpperCase();

async function makeBook(priceMinor = 15000): Promise<string> {
  const book = await db.book.create({
    data: {
      slug: `${SLUG_PREFIX}${crypto.randomUUID()}`,
      title: "Test Book",
      authorCredit: "TEST",
      description: "d",
      published: true,
      formats: { create: [{ type: "EBOOK", priceMinor, isAvailable: true }] },
    },
    include: { formats: true },
  });
  return book.formats[0]!.id;
}

async function makeOrder(opts: { formatId?: string } = {}) {
  const formatId = opts.formatId ?? (await makeBook());
  const result = await createOrder({
    bookFormatId: formatId,
    quantity: 1,
    customerName: "Test Buyer",
    customerEmail: `c-${crypto.randomUUID()}@${EMAIL_DOMAIN}`,
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

/** A fresh order with exactly one PENDING_REVIEW claim, via the real buyer
 *  submission path — never written directly. */
async function makeSubmittedOrder(opts: { priceMinor?: number } = {}) {
  const formatId = await makeBook(opts.priceMinor ?? 15000);
  const order = await makeOrder({ formatId });
  const claimResult = await submitClaim(claimInput(order));
  if (!claimResult.ok) throw new Error("claim setup failed");
  return { order, claim: claimResult.claim };
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

beforeEach(async () => {
  await wipe();
  ADMIN_ID = await makeAdmin();
});
afterAll(async () => {
  await wipe();
  await db.$disconnect();
});

describe("decideClaim — exact match", () => {
  it("confirms the order, sets paymentConfirmedAt, accepts the claim, writes one event", async () => {
    const { order, claim } = await makeSubmittedOrder({ priceMinor: 15000 });

    const result = await decideClaim({
      claimId: claim.id,
      matchedAmountKwacha: "150.00",
      actorId: ADMIN_ID,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.outcome).toBe("CONFIRMED");

    const freshOrder = await db.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(freshOrder.paymentState).toBe("CONFIRMED");
    expect(freshOrder.paymentConfirmedAt).toBeInstanceOf(Date);

    const freshClaim = await db.paymentClaim.findUniqueOrThrow({ where: { id: claim.id } });
    expect(freshClaim.status).toBe("ACCEPTED");
    expect(freshClaim.matchedAmountMinor).toBe(15000);
    expect(freshClaim.reviewedById).toBe(ADMIN_ID);
    expect(freshClaim.reviewedAt).toBeInstanceOf(Date);

    const events = await db.orderEvent.findMany({
      where: { orderId: order.id, type: "payment.confirmed" },
    });
    expect(events).toHaveLength(1);
    expect(events[0].actorType).toBe("ADMIN");
  });
});

describe("decideClaim — underpayment", () => {
  it("moves the order to UNDERPAID, not CONFIRMED", async () => {
    const { order, claim } = await makeSubmittedOrder({ priceMinor: 15000 });

    const result = await decideClaim({
      claimId: claim.id,
      matchedAmountKwacha: "100.00",
      actorId: ADMIN_ID,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.outcome).toBe("UNDERPAID");

    const freshOrder = await db.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(freshOrder.paymentState).toBe("UNDERPAID");
    expect(freshOrder.paymentConfirmedAt).toBeNull();

    const freshClaim = await db.paymentClaim.findUniqueOrThrow({ where: { id: claim.id } });
    expect(freshClaim.status).toBe("ACCEPTED");
    expect(freshClaim.matchedAmountMinor).toBe(10000);
  });
});

describe("decideClaim — overpayment requires a note", () => {
  it("refuses without a note and changes nothing", async () => {
    const { order, claim } = await makeSubmittedOrder({ priceMinor: 15000 });

    const result = await decideClaim({
      claimId: claim.id,
      matchedAmountKwacha: "200.00",
      actorId: ADMIN_ID,
    });

    expect(result).toEqual({
      ok: false,
      error: "invalid_input",
      issues: expect.objectContaining({ reviewNote: expect.any(String) }),
    });

    const freshOrder = await db.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(freshOrder.paymentState).toBe("SUBMITTED");
    const freshClaim = await db.paymentClaim.findUniqueOrThrow({ where: { id: claim.id } });
    expect(freshClaim.status).toBe("PENDING_REVIEW");
  });

  it("confirms with a note, and stores it", async () => {
    const { order, claim } = await makeSubmittedOrder({ priceMinor: 15000 });

    const result = await decideClaim({
      claimId: claim.id,
      matchedAmountKwacha: "200.00",
      reviewNote: "Will refund the K50 difference via mobile money.",
      actorId: ADMIN_ID,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.outcome).toBe("CONFIRMED");

    const freshOrder = await db.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(freshOrder.paymentState).toBe("CONFIRMED");

    const freshClaim = await db.paymentClaim.findUniqueOrThrow({ where: { id: claim.id } });
    expect(freshClaim.reviewNote).toBe("Will refund the K50 difference via mobile money.");
    expect(freshClaim.matchedAmountMinor).toBe(20000);
  });
});

describe("decideClaim — invalid amount", () => {
  it("refuses an unparseable amount and changes nothing", async () => {
    const { order, claim } = await makeSubmittedOrder();

    const result = await decideClaim({
      claimId: claim.id,
      matchedAmountKwacha: "not a number",
      actorId: ADMIN_ID,
    });

    expect(result.ok).toBe(false);
    const freshOrder = await db.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(freshOrder.paymentState).toBe("SUBMITTED");
  });
});

describe("decideClaim — already reviewed", () => {
  it("refuses a second decision on the same claim", async () => {
    const { claim } = await makeSubmittedOrder({ priceMinor: 15000 });

    const first = await decideClaim({
      claimId: claim.id,
      matchedAmountKwacha: "150.00",
      actorId: ADMIN_ID,
    });
    expect(first.ok).toBe(true);

    const second = await decideClaim({
      claimId: claim.id,
      matchedAmountKwacha: "150.00",
      actorId: ADMIN_ID,
    });
    expect(second).toEqual({ ok: false, error: "already_reviewed" });
  });
});

describe("rejectClaim", () => {
  it("stores the reason, moves the order to REJECTED, and allows resubmission", async () => {
    const { order, claim } = await makeSubmittedOrder();

    const result = await rejectClaim({
      claimId: claim.id,
      reasonCode: "reference_not_found",
      note: "internal note",
      actorId: ADMIN_ID,
    });
    expect(result.ok).toBe(true);

    const freshOrder = await db.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(freshOrder.paymentState).toBe("REJECTED");

    const freshClaim = await db.paymentClaim.findUniqueOrThrow({ where: { id: claim.id } });
    expect(freshClaim.status).toBe("REJECTED");
    expect(freshClaim.rejectionReason).toBe("reference_not_found");
    expect(freshClaim.reviewNote).toBe("internal note");

    // The buyer can submit a fresh claim on a REJECTED order (existing path,
    // proven here still works end to end after a review-layer rejection).
    const resubmit = await submitClaim(claimInput(order));
    expect(resubmit.ok).toBe(true);
  });

  it("refuses an unknown reason code and changes nothing", async () => {
    const { order, claim } = await makeSubmittedOrder();

    const result = await rejectClaim({
      claimId: claim.id,
      reasonCode: "made_up_reason",
      actorId: ADMIN_ID,
    });

    expect(result).toEqual({
      ok: false,
      error: "invalid_input",
      issues: expect.objectContaining({ reasonCode: expect.any(String) }),
    });
    const freshOrder = await db.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(freshOrder.paymentState).toBe("SUBMITTED");
  });
});

describe("decideClaim — concurrency: two admins confirm the same claim", () => {
  it("one succeeds, one throws PaymentTransitionError; one CONFIRMED, one event, claim decided once", async () => {
    const { order, claim } = await makeSubmittedOrder({ priceMinor: 15000 });
    const [adminA, adminB] = await Promise.all([makeAdmin(), makeAdmin()]);

    const settled = await Promise.allSettled<DecideClaimResult>([
      decideClaim({ claimId: claim.id, matchedAmountKwacha: "150.00", actorId: adminA }),
      decideClaim({ claimId: claim.id, matchedAmountKwacha: "150.00", actorId: adminB }),
    ]);

    const fulfilled = settled.filter(
      (s): s is PromiseFulfilledResult<DecideClaimResult> => s.status === "fulfilled",
    );
    const rejected = settled.filter(
      (s): s is PromiseRejectedResult => s.status === "rejected",
    );

    // Either both "succeed" at the ok:true/ok:false HTTP-ish layer, or one
    // throws — decideClaim only throws for the genuine race (transitionPayment
    // itself), so assert on that directly rather than assuming which shape
    // the loser takes.
    const okTrue = fulfilled.filter((f) => f.value.ok);
    expect(okTrue).toHaveLength(1);
    expect(rejected.length + fulfilled.filter((f) => !f.value.ok).length).toBe(1);
    if (rejected.length === 1) {
      expect(rejected[0].reason).toBeInstanceOf(PaymentTransitionError);
    }

    const freshOrder = await db.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(freshOrder.paymentState).toBe("CONFIRMED");
    expect(freshOrder.paymentConfirmedAt).toBeInstanceOf(Date);

    const events = await db.orderEvent.findMany({
      where: { orderId: order.id, type: "payment.confirmed" },
    });
    expect(events).toHaveLength(1);

    const freshClaim = await db.paymentClaim.findUniqueOrThrow({ where: { id: claim.id } });
    expect(freshClaim.status).toBe("ACCEPTED");
  });
});

describe("reopenOrder", () => {
  it("extends paymentExpiresAt and leaves paymentState at EXPIRED", async () => {
    const order = await makeOrder();
    await db.$transaction((tx) => transitionPayment(tx, order.id, "EXPIRED", { type: "SYSTEM" }));

    const before = await db.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(before.paymentState).toBe("EXPIRED");

    const result = await reopenOrder({ orderId: order.id, actorId: ADMIN_ID });
    expect(result.ok).toBe(true);

    const after = await db.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(after.paymentState).toBe("EXPIRED");
    expect(after.paymentExpiresAt.getTime()).toBeGreaterThan(before.paymentExpiresAt.getTime());

    const events = await db.orderEvent.findMany({
      where: { orderId: order.id, type: "order.reopened" },
    });
    expect(events).toHaveLength(1);
  });

  it("refuses a non-expired order and changes nothing", async () => {
    const order = await makeOrder();
    const before = await db.order.findUniqueOrThrow({ where: { id: order.id } });

    const result = await reopenOrder({ orderId: order.id, actorId: ADMIN_ID });
    expect(result).toEqual({ ok: false, error: "not_expired" });

    const after = await db.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(after.paymentExpiresAt.getTime()).toBe(before.paymentExpiresAt.getTime());
  });
});
