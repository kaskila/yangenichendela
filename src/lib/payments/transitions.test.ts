import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { PaymentState } from "@/generated/prisma/client";
import {
  ConflictError,
  IllegalTransitionError,
  LEGAL_PAYMENT_TRANSITIONS,
  OrderNotFoundError,
  PaymentTransitionError,
  recordOrderEvent,
  transitionPayment,
  type EventActor,
} from "@/lib/payments/transitions";

// Integration tests against the real .env.test Postgres database (CLAUDE.md:
// a mocked Prisma client would let a read-then-decide implementation of the
// guarded update pass — which is the one thing the concurrency test exists to
// catch). fileParallelism is false, so there is a single database.

const TEST_EMAIL_DOMAIN = "pay-test.local";
const SYSTEM: EventActor = { type: "SYSTEM" };

const ALL_STATES = Object.values(PaymentState);

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Shortest path from the PENDING default to any state, walked with real
// transitionPayment calls so no test ever writes paymentState directly (Rule 3).
const PATH_TO: Record<PaymentState, PaymentState[]> = {
  PENDING: [],
  SUBMITTED: ["SUBMITTED"],
  CONFIRMED: ["SUBMITTED", "CONFIRMED"],
  REJECTED: ["SUBMITTED", "REJECTED"],
  UNDERPAID: ["SUBMITTED", "UNDERPAID"],
  EXPIRED: ["EXPIRED"],
  CANCELLED: ["CANCELLED"],
  REFUNDED: ["SUBMITTED", "CONFIRMED", "REFUNDED"],
};

async function makeOrder() {
  const id = crypto.randomUUID();
  return db.order.create({
    data: {
      reference: `PAYTEST-${id.slice(0, 8).toUpperCase()}`,
      accessToken: id,
      customerName: "Test Buyer",
      customerEmail: `buyer-${id}@${TEST_EMAIL_DOMAIN}`,
      customerPhone: "+260977000000",
      subtotalMinor: 25000,
      totalMinor: 25000,
      paymentExpiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000),
    },
  });
}

function transition(orderId: string, to: PaymentState, actor: EventActor = SYSTEM) {
  return db.$transaction((tx) => transitionPayment(tx, orderId, to, actor), {
    timeout: 15_000,
  });
}

/** A fresh order parked in `state` via the real state machine. */
async function seedOrderInState(state: PaymentState): Promise<string> {
  const order = await makeOrder();
  for (const step of PATH_TO[state]) {
    await transition(order.id, step);
  }
  return order.id;
}

async function eventIds(orderId: string): Promise<Set<string>> {
  const rows = await db.orderEvent.findMany({
    where: { orderId },
    select: { id: true },
  });
  return new Set(rows.map((r) => r.id));
}

async function newEventsSince(orderId: string, before: Set<string>) {
  const rows = await db.orderEvent.findMany({ where: { orderId } });
  return rows.filter((r) => !before.has(r.id));
}

async function paymentStateOf(orderId: string): Promise<PaymentState> {
  const order = await db.order.findUniqueOrThrow({ where: { id: orderId } });
  return order.paymentState;
}

beforeEach(cleanup);
afterAll(async () => {
  await cleanup();
  await db.$disconnect();
});

async function cleanup() {
  // OrderEvent / OrderItem rows cascade on Order delete.
  await db.order.deleteMany({
    where: { customerEmail: { endsWith: `@${TEST_EMAIL_DOMAIN}` } },
  });
}

// --- the legal / illegal matrix --------------------------------------------

const legalPairs: Array<[PaymentState, PaymentState]> = ALL_STATES.flatMap(
  (from) => LEGAL_PAYMENT_TRANSITIONS[from].map((to) => [from, to] as [PaymentState, PaymentState]),
);

const illegalPairs: Array<[PaymentState, PaymentState]> = ALL_STATES.flatMap((from) =>
  ALL_STATES.filter((to) => !LEGAL_PAYMENT_TRANSITIONS[from].includes(to)).map(
    (to) => [from, to] as [PaymentState, PaymentState],
  ),
);

describe("the transition table itself", () => {
  it("has exactly 12 legal ordered pairs and 52 illegal (8x8 minus 12)", () => {
    expect(legalPairs).toHaveLength(12);
    expect(illegalPairs).toHaveLength(ALL_STATES.length * ALL_STATES.length - 12);
    expect(illegalPairs).toHaveLength(52);
  });

  it("lists no state as a legal transition to itself", () => {
    for (const from of ALL_STATES) {
      expect(LEGAL_PAYMENT_TRANSITIONS[from]).not.toContain(from);
    }
  });
});

describe("legal transitions", () => {
  it.each(legalPairs)("%s -> %s succeeds and writes one OrderEvent", async (from, to) => {
    const id = await seedOrderInState(from);
    const before = await eventIds(id);

    const returned = await transition(id, to, { type: "ADMIN", id: "admin-1" });

    expect(returned.paymentState).toBe(to);
    expect(await paymentStateOf(id)).toBe(to);

    const created = await newEventsSince(id, before);
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({
      type: `payment.${to.toLowerCase()}`,
      fromState: from,
      toState: to,
      actorType: "ADMIN",
      actorId: "admin-1",
    });
  });
});

describe("illegal transitions (full matrix, not a sample)", () => {
  it.each(illegalPairs)("%s -> %s throws and writes nothing", async (from, to) => {
    const id = await seedOrderInState(from);
    const before = await eventIds(id);

    await expect(transition(id, to)).rejects.toBeInstanceOf(IllegalTransitionError);

    expect(await paymentStateOf(id)).toBe(from);
    expect(await newEventsSince(id, before)).toHaveLength(0);
  });

  it("PENDING -> CONFIRMED throws (named in the brief)", async () => {
    const id = await seedOrderInState("PENDING");
    await expect(transition(id, "CONFIRMED")).rejects.toBeInstanceOf(IllegalTransitionError);
  });

  it("CONFIRMED -> SUBMITTED throws (named in the brief)", async () => {
    const id = await seedOrderInState("CONFIRMED");
    await expect(transition(id, "SUBMITTED")).rejects.toBeInstanceOf(IllegalTransitionError);
  });

  it.each(ALL_STATES)("REFUNDED -> %s throws (terminal state)", async (to) => {
    const id = await seedOrderInState("REFUNDED");
    await expect(transition(id, to)).rejects.toBeInstanceOf(IllegalTransitionError);
    expect(await paymentStateOf(id)).toBe("REFUNDED");
  });
});

describe("same-state transitions", () => {
  it.each(ALL_STATES)("%s -> %s (itself) throws", async (state) => {
    const id = await seedOrderInState(state);
    await expect(transition(id, state)).rejects.toBeInstanceOf(IllegalTransitionError);
    expect(await paymentStateOf(id)).toBe(state);
  });
});

describe("unknown order", () => {
  it("throws OrderNotFoundError and writes no OrderEvent", async () => {
    await expect(transition("does-not-exist", "SUBMITTED")).rejects.toBeInstanceOf(
      OrderNotFoundError,
    );
    expect(await db.orderEvent.count({ where: { orderId: "does-not-exist" } })).toBe(0);
  });
});

describe("paymentConfirmedAt is set on CONFIRMED and nowhere else", () => {
  it("is set moving SUBMITTED -> CONFIRMED", async () => {
    const id = await seedOrderInState("SUBMITTED");
    const returned = await transition(id, "CONFIRMED");
    expect(returned.paymentConfirmedAt).toBeInstanceOf(Date);
  });

  it("is set moving UNDERPAID -> CONFIRMED", async () => {
    const id = await seedOrderInState("UNDERPAID");
    const returned = await transition(id, "CONFIRMED");
    expect(returned.paymentConfirmedAt).toBeInstanceOf(Date);
  });

  it("is not cleared by a later CONFIRMED -> REFUNDED", async () => {
    const id = await seedOrderInState("CONFIRMED");
    const confirmedAt = (await db.order.findUniqueOrThrow({ where: { id } }))
      .paymentConfirmedAt;
    expect(confirmedAt).toBeInstanceOf(Date);

    const returned = await transition(id, "REFUNDED");
    expect(returned.paymentConfirmedAt?.getTime()).toBe(confirmedAt?.getTime());
  });

  it.each(["SUBMITTED", "REJECTED", "UNDERPAID", "EXPIRED", "CANCELLED"] as const)(
    "is null for an order parked at %s",
    async (state) => {
      const id = await seedOrderInState(state);
      const order = await db.order.findUniqueOrThrow({ where: { id } });
      expect(order.paymentConfirmedAt).toBeNull();
    },
  );
});

describe("a throwing transition leaves no trace", () => {
  it("illegal transition: state unchanged, no event", async () => {
    const id = await seedOrderInState("PENDING");
    const before = await eventIds(id);
    await expect(transition(id, "REFUNDED")).rejects.toBeInstanceOf(IllegalTransitionError);
    expect(await paymentStateOf(id)).toBe("PENDING");
    expect(await newEventsSince(id, before)).toHaveLength(0);
  });

  it("ConflictError from a stale-read call writes no event and does not move the order", async () => {
    // The REJECTED call's read lands inside the still-open CONFIRMED transaction,
    // so it sees SUBMITTED and passes validation; its guarded update then matches
    // zero rows once CONFIRMED commits. SUBMITTED -> REJECTED is a legal pair —
    // the guard, not the table, is what rejects it here.
    const id = await seedOrderInState("SUBMITTED");

    const held = db.$transaction(
      async (tx) => {
        await transitionPayment(tx, id, "CONFIRMED", { type: "ADMIN", id: "admin-a" });
        await sleep(400);
      },
      { timeout: 15_000 },
    );
    const stale = sleep(150).then(() =>
      expect(transition(id, "REJECTED")).rejects.toBeInstanceOf(ConflictError),
    );

    await Promise.all([held, stale]);

    expect(await paymentStateOf(id)).toBe("CONFIRMED");
    expect(await db.orderEvent.count({ where: { orderId: id, type: "payment.rejected" } })).toBe(0);
  });
});

describe("concurrency: double confirmation of one order", () => {
  it("deterministic interleave: one CONFIRMED, one ConflictError, one event", async () => {
    // The first call holds its transaction open (sleep) after the guarded
    // update. The second starts mid-flight: its read sees the still-uncommitted
    // SUBMITTED, it passes validation, then its guarded update blocks on the row
    // lock and — once the first commits CONFIRMED — matches zero rows.
    const id = await seedOrderInState("SUBMITTED");
    const before = await eventIds(id);

    const first = db.$transaction(
      async (tx) => {
        const order = await transitionPayment(tx, id, "CONFIRMED", {
          type: "ADMIN",
          id: "admin-a",
        });
        await sleep(400);
        return order;
      },
      { timeout: 15_000 },
    );
    const second = sleep(150).then(() =>
      db.$transaction(
        (tx) => transitionPayment(tx, id, "CONFIRMED", { type: "ADMIN", id: "admin-b" }),
        { timeout: 15_000 },
      ),
    );

    const settled = await Promise.allSettled([first, second]);
    const fulfilled = settled.filter((s) => s.status === "fulfilled");
    const rejected = settled.filter(
      (s): s is PromiseRejectedResult => s.status === "rejected",
    );

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toBeInstanceOf(ConflictError);

    expect(await paymentStateOf(id)).toBe("CONFIRMED");

    const created = await newEventsSince(id, before);
    expect(created).toHaveLength(1);
    expect(created[0].type).toBe("payment.confirmed");

    const order = await db.order.findUniqueOrThrow({ where: { id } });
    expect(order.paymentConfirmedAt).toBeInstanceOf(Date);
  });

  it("raw parallel calls: whichever interleaving, one wins and one event exists", async () => {
    // No artificial timing. Depending on scheduling the loser throws either
    // ConflictError (its read saw SUBMITTED) or IllegalTransitionError (its read
    // saw the committed CONFIRMED) — both safely reject the double confirm.
    const id = await seedOrderInState("SUBMITTED");
    const before = await eventIds(id);

    const settled = await Promise.allSettled([
      transition(id, "CONFIRMED", { type: "ADMIN", id: "admin-a" }),
      transition(id, "CONFIRMED", { type: "ADMIN", id: "admin-b" }),
    ]);
    const fulfilled = settled.filter((s) => s.status === "fulfilled");
    const rejected = settled.filter(
      (s): s is PromiseRejectedResult => s.status === "rejected",
    );

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toBeInstanceOf(PaymentTransitionError);

    expect(await paymentStateOf(id)).toBe("CONFIRMED");
    expect(await newEventsSince(id, before)).toHaveLength(1);
  });
});

describe("recordOrderEvent (non-transition audit rows)", () => {
  it("appends an event without touching paymentState", async () => {
    const id = await seedOrderInState("SUBMITTED");

    const event = await db.$transaction((tx) =>
      recordOrderEvent(tx, {
        orderId: id,
        type: "claim.submitted",
        actor: { type: "BUYER" },
        metadata: { transactionId: "MP2401.1234" },
      }),
    );

    expect(event.type).toBe("claim.submitted");
    expect(event.fromState).toBeNull();
    expect(event.toState).toBeNull();
    expect(event.actorType).toBe("BUYER");
    expect(event.metadata).toEqual({ transactionId: "MP2401.1234" });
    expect(await paymentStateOf(id)).toBe("SUBMITTED");
  });
});
