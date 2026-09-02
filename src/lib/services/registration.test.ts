import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { RegistrationStatus } from "@/generated/prisma/client";
import {
  cancelRegistration,
  checkIn,
  normaliseZambianPhone,
  registerForEvent,
  type RegisterInput,
  type RegisterResult,
} from "@/lib/services/registration";

// Integration tests against the real .env.test Postgres database. A mocked
// Prisma client would let a read-then-write seat claim pass — which is the one
// thing the concurrency test exists to catch.

const EMAIL_DOMAIN = "reg-test.local";

function assertOk<T extends { ok: boolean }>(
  r: T,
): asserts r is Extract<T, { ok: true }> {
  if (!r.ok) throw new Error(`expected ok result, got ${JSON.stringify(r)}`);
}

async function makeEvent(opts: { seats: number; open?: boolean }) {
  return db.launchEvent.create({
    data: {
      slug: `evt-${crypto.randomUUID()}`,
      title: "Test launch",
      capacity: opts.seats,
      seatsRemaining: opts.seats,
      registrationOpen: opts.open ?? true,
    },
  });
}

async function makeStaff() {
  const id = crypto.randomUUID();
  return db.user.create({
    data: {
      id,
      name: "Door staff",
      email: `staff-${id}@${EMAIL_DOMAIN}`,
      role: "STAFF",
    },
  });
}

function baseInput(overrides: Partial<RegisterInput> & { eventSlug: string }): RegisterInput {
  return {
    name: "Chanda Mwansa",
    email: `d-${crypto.randomUUID()}@${EMAIL_DOMAIN}`,
    phone: "0977123456",
    ...overrides,
  };
}

beforeEach(async () => {
  await db.registration.deleteMany();
  await db.launchEvent.deleteMany();
});

afterAll(async () => {
  await db.registration.deleteMany();
  await db.launchEvent.deleteMany();
  await db.user.deleteMany({ where: { email: { endsWith: `@${EMAIL_DOMAIN}` } } });
  await db.$disconnect();
});

describe("registerForEvent — capacity cap", () => {
  it("250 concurrent registrations against 200 seats: exactly 200 confirmed, 50 waitlisted", async () => {
    const event = await makeEvent({ seats: 200 });

    const inputs = Array.from({ length: 250 }, (_, i) =>
      baseInput({
        eventSlug: event.slug,
        email: `delegate-${i}@${EMAIL_DOMAIN}`,
        name: `Delegate ${i}`,
      }),
    );

    const results = await Promise.all(inputs.map((input) => registerForEvent(input)));

    expect(results.every((r) => r.ok)).toBe(true);

    const confirmed = results.filter(
      (r) => r.ok && r.status === RegistrationStatus.CONFIRMED,
    ).length;
    const waitlisted = results.filter(
      (r) => r.ok && r.status === RegistrationStatus.WAITLIST,
    ).length;

    expect(confirmed).toBe(200);
    expect(waitlisted).toBe(50);

    const after = await db.launchEvent.findUniqueOrThrow({ where: { id: event.id } });
    expect(after.seatsRemaining).toBe(0);

    const rows = await db.registration.findMany({ where: { eventId: event.id } });
    expect(rows).toHaveLength(250);
    expect(new Set(rows.map((r) => r.code)).size).toBe(250);
    expect(rows.filter((r) => r.status === RegistrationStatus.CONFIRMED)).toHaveLength(200);
  });

  it("refuses registration when registrationOpen is false", async () => {
    const event = await makeEvent({ seats: 10, open: false });

    const result = await registerForEvent(baseInput({ eventSlug: event.slug }));

    expect(result).toEqual({ ok: false, reason: "registration_closed" });
    expect(await db.registration.count({ where: { eventId: event.id } })).toBe(0);
  });

  it("returns event_not_found for an unknown slug", async () => {
    const result = await registerForEvent(baseInput({ eventSlug: "no-such-event" }));
    expect(result).toEqual({ ok: false, reason: "event_not_found" });
  });
});

describe("registerForEvent — idempotency", () => {
  it("a repeat submission returns the existing registration", async () => {
    const event = await makeEvent({ seats: 10 });
    const input = baseInput({ eventSlug: event.slug, email: `dupe@${EMAIL_DOMAIN}` });

    const first = await registerForEvent(input);
    const second = await registerForEvent(input);

    assertOk(first);
    assertOk(second);
    expect(second.deduped).toBe(true);
    expect(second.registration.id).toBe(first.registration.id);
    expect(second.registration.code).toBe(first.registration.code);
    expect(await db.registration.count({ where: { eventId: event.id } })).toBe(1);
  });

  it("revives a CANCELLED row on re-registration rather than blocking the email", async () => {
    const event = await makeEvent({ seats: 10 });
    const input = baseInput({ eventSlug: event.slug, email: `revive@${EMAIL_DOMAIN}` });

    const first = await registerForEvent(input);
    assertOk(first);
    await cancelRegistration(first.registration.code);

    const again = await registerForEvent(input);
    assertOk(again);

    expect(again.registration.id).toBe(first.registration.id);
    expect(again.status).toBe(RegistrationStatus.CONFIRMED);
    expect(again.deduped).toBe(false);
    expect(await db.registration.count({ where: { eventId: event.id } })).toBe(1);
  });
});

describe("cancelRegistration", () => {
  it("promotes the waitlist head and does NOT increment seatsRemaining", async () => {
    const event = await makeEvent({ seats: 1 });

    const a = await registerForEvent(baseInput({ eventSlug: event.slug }));
    const b = await registerForEvent(baseInput({ eventSlug: event.slug }));
    assertOk(a);
    assertOk(b);
    expect(a.status).toBe(RegistrationStatus.CONFIRMED);
    expect(b.status).toBe(RegistrationStatus.WAITLIST);

    const cancelled = await cancelRegistration(a.registration.code);
    assertOk(cancelled);

    expect(cancelled.promoted?.id).toBe(b.registration.id);

    const bAfter = await db.registration.findUniqueOrThrow({
      where: { id: b.registration.id },
    });
    expect(bAfter.status).toBe(RegistrationStatus.CONFIRMED);
    expect(bAfter.waitlistRank).toBeNull();

    const eventAfter = await db.launchEvent.findUniqueOrThrow({ where: { id: event.id } });
    expect(eventAfter.seatsRemaining).toBe(0);
  });

  it("increments seatsRemaining by exactly one when the waitlist is empty", async () => {
    const event = await makeEvent({ seats: 1 });

    const a = await registerForEvent(baseInput({ eventSlug: event.slug }));
    assertOk(a);

    const cancelled = await cancelRegistration(a.registration.code);

    expect(cancelled).toEqual({ ok: true, promoted: null });
    const eventAfter = await db.launchEvent.findUniqueOrThrow({ where: { id: event.id } });
    expect(eventAfter.seatsRemaining).toBe(1);
  });

  it("cancelling a waitlisted row frees no seat", async () => {
    const event = await makeEvent({ seats: 1 });
    await registerForEvent(baseInput({ eventSlug: event.slug }));
    const b = await registerForEvent(baseInput({ eventSlug: event.slug }));
    assertOk(b);

    const cancelled = await cancelRegistration(b.registration.code);
    expect(cancelled).toEqual({ ok: true, promoted: null });

    const eventAfter = await db.launchEvent.findUniqueOrThrow({ where: { id: event.id } });
    expect(eventAfter.seatsRemaining).toBe(0);
  });

  it("is idempotent and case-insensitive on the code", async () => {
    const event = await makeEvent({ seats: 5 });
    const a = await registerForEvent(baseInput({ eventSlug: event.slug }));
    assertOk(a);

    const once = await cancelRegistration(a.registration.code.toLowerCase());
    const twice = await cancelRegistration(a.registration.code);

    expect(once).toEqual({ ok: true, promoted: null });
    expect(twice).toEqual({ ok: true, promoted: null });
    // Seat returned exactly once, not once per call.
    const eventAfter = await db.launchEvent.findUniqueOrThrow({ where: { id: event.id } });
    expect(eventAfter.seatsRemaining).toBe(5);
  });

  it("returns not_found for an unknown code", async () => {
    expect(await cancelRegistration("YC-ZZZZZZ")).toEqual({ ok: false, reason: "not_found" });
  });
});

describe("checkIn", () => {
  it("a second check-in is a neutral already_checked_in, checkedInAt unchanged", async () => {
    const event = await makeEvent({ seats: 5 });
    const staff1 = await makeStaff();
    const staff2 = await makeStaff();
    const a = await registerForEvent(baseInput({ eventSlug: event.slug }));
    assertOk(a);

    const first = await checkIn(a.registration.code, staff1.id);
    assertOk(first);
    expect(first.outcome).toBe("checked_in");

    const afterFirst = await db.registration.findUniqueOrThrow({
      where: { id: a.registration.id },
    });
    expect(afterFirst.checkedInAt).not.toBeNull();
    expect(afterFirst.checkedInById).toBe(staff1.id);

    const second = await checkIn(a.registration.code.toLowerCase(), staff2.id);
    assertOk(second);
    expect(second.outcome).toBe("already_checked_in");

    const afterSecond = await db.registration.findUniqueOrThrow({
      where: { id: a.registration.id },
    });
    expect(afterSecond.checkedInAt?.getTime()).toBe(afterFirst.checkedInAt?.getTime());
    expect(afterSecond.checkedInById).toBe(staff1.id);
  });

  it("returns not_found for an unknown code", async () => {
    const staff = await makeStaff();
    expect(await checkIn("YC-ZZZZZZ", staff.id)).toEqual({ ok: false, reason: "not_found" });
  });
});

describe("input validation", () => {
  it("rejects an implausible phone number", async () => {
    const event = await makeEvent({ seats: 10 });
    const result = (await registerForEvent(
      baseInput({ eventSlug: event.slug, phone: "12345" }),
    )) as Extract<RegisterResult, { ok: false; reason: "invalid_input" }>;

    expect(result.ok).toBe(false);
    expect(result.reason).toBe("invalid_input");
    expect(result.issues.phone).toBeDefined();
    expect(await db.registration.count({ where: { eventId: event.id } })).toBe(0);
  });

  it("normalises Zambian phone numbers to +260 E.164", () => {
    for (const variant of [
      "0977123456",
      "+260977123456",
      "260977123456",
      "260 977 123 456",
      "+260 977 123 456",
      "(0977) 123-456",
    ]) {
      expect(normaliseZambianPhone(variant)).toBe("+260977123456");
    }
    expect(normaliseZambianPhone("12345")).toBeNull();
    expect(normaliseZambianPhone("+1 415 555 0100")).toBeNull();
  });
});
