import { afterAll, afterEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { subscribeToNewsletter } from "@/lib/services/newsletter";

// Integration tests against the real .env.test database. The invariant worth
// guarding: a repeat submission of the same address is idempotent — no throw,
// no duplicate row.

const DOMAIN = "newsletter-test.local";

afterEach(async () => {
  await db.newsletterSubscriber.deleteMany({ where: { email: { endsWith: `@${DOMAIN}` } } });
});
afterAll(async () => {
  await db.newsletterSubscriber.deleteMany({ where: { email: { endsWith: `@${DOMAIN}` } } });
  await db.$disconnect();
});

describe("subscribeToNewsletter", () => {
  it("stores a new address as PENDING with its source", async () => {
    const email = `reader-${crypto.randomUUID()}@${DOMAIN}`;
    const result = await subscribeToNewsletter({ email, source: "homepage" });
    expect(result).toEqual({ ok: true });

    const row = await db.newsletterSubscriber.findUniqueOrThrow({ where: { email } });
    expect(row.status).toBe("PENDING");
    expect(row.source).toBe("homepage");
    expect(row.unsubscribeToken.length).toBeGreaterThan(0);
  });

  it("normalises case and whitespace before storing", async () => {
    const id = crypto.randomUUID();
    const result = await subscribeToNewsletter({
      email: `  Reader-${id}@${DOMAIN.toUpperCase()}  `,
      source: "homepage",
    });
    expect(result.ok).toBe(true);
    const row = await db.newsletterSubscriber.findFirst({
      where: { email: `reader-${id}@${DOMAIN}` },
    });
    expect(row).not.toBeNull();
  });

  it("is idempotent — a repeat submission neither throws nor duplicates", async () => {
    const email = `twice-${crypto.randomUUID()}@${DOMAIN}`;
    await subscribeToNewsletter({ email, source: "homepage" });
    const second = await subscribeToNewsletter({ email, source: "footer" });
    expect(second).toEqual({ ok: true });

    const rows = await db.newsletterSubscriber.findMany({ where: { email } });
    expect(rows).toHaveLength(1);
    // The original row is left untouched — the form must not reveal membership
    // or silently rewrite an existing record.
    expect(rows[0]!.source).toBe("homepage");
  });

  it("rejects a malformed address without writing a row", async () => {
    const result = await subscribeToNewsletter({ email: "not-an-email", source: "homepage" });
    expect(result).toEqual({ ok: false, error: "invalid_email" });

    const count = await db.newsletterSubscriber.count({
      where: { email: { contains: "not-an-email" } },
    });
    expect(count).toBe(0);
  });
});
