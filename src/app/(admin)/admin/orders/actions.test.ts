import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { transitionPayment } from "@/lib/payments/transitions";
import { createOrder } from "@/lib/services/orders";
import { submitClaim, type SubmitClaimInput } from "@/lib/services/claims";
import type { SessionUser } from "@/lib/auth";

// This is the only place Rule 5 ("every server action starts with
// requireAdmin()") is exercised directly against the action layer — the
// underlying services (claim-review.ts) deliberately take no role, so a
// STAFF-refusal test has to live here. requireAdmin() itself needs a real
// Next.js request scope (next/headers) that a plain vitest run doesn't have,
// so it's mocked wholesale: a STAFF session is simulated by making it reject,
// exactly as forbidden() does for a signed-in-wrong-role user. redirect() and
// revalidatePath() also need a request scope the actions call on success, so
// they're mocked too.

vi.mock("@/lib/auth/guards", () => ({
  requireAdmin: vi.fn(),
  requireStaff: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
}));
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

const { requireAdmin } = await import("@/lib/auth/guards");
const { decideClaimAction, rejectClaimAction, reopenOrderAction } = await import("./actions");

const EMAIL_DOMAIN = "orders-actions-test.local";
const SLUG_PREFIX = "orders-actions-test-";
const FORBIDDEN = Object.assign(new Error("Forbidden"), { digest: "NEXT_HTTP_ERROR_FALLBACK;403" });

// requireAdmin() is mocked to resolve this, and decideClaim/rejectClaim/
// reopenOrder use admin.id as PaymentClaim.reviewedById — a real foreign key
// to User — so it has to be a real row, created fresh per test.
let ADMIN: SessionUser;

async function makeAdminUser(): Promise<SessionUser> {
  const id = crypto.randomUUID();
  const user = await db.user.create({
    data: { id, name: "Test Admin", email: `admin-${id}@${EMAIL_DOMAIN}`, role: "ADMIN" },
  });
  return user as unknown as SessionUser;
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

async function makeOrder() {
  const formatId = await makeBook();
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

function claimInput(order: { reference: string; accessToken: string }): SubmitClaimInput {
  return {
    orderReference: order.reference,
    accessToken: order.accessToken,
    network: "AIRTEL",
    senderPhone: "0966123456",
    transactionId: txn(),
  };
}

async function makeSubmittedOrder() {
  const order = await makeOrder();
  const claimResult = await submitClaim(claimInput(order));
  if (!claimResult.ok) throw new Error("claim setup failed");
  return { order, claim: claimResult.claim };
}

function formData(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [key, value] of Object.entries(fields)) fd.set(key, value);
  return fd;
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
  vi.mocked(requireAdmin).mockReset();
  await wipe();
  ADMIN = await makeAdminUser();
});
afterAll(async () => {
  await wipe();
  await db.$disconnect();
});

describe("decideClaimAction", () => {
  it("a STAFF (forbidden) session is refused and nothing changes", async () => {
    const { order, claim } = await makeSubmittedOrder();
    vi.mocked(requireAdmin).mockRejectedValueOnce(FORBIDDEN);

    await expect(
      decideClaimAction(
        { status: "idle" },
        formData({
          claimId: claim.id,
          orderReference: order.reference,
          matchedAmountKwacha: "150.00",
        }),
      ),
    ).rejects.toBe(FORBIDDEN);

    const freshOrder = await db.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(freshOrder.paymentState).toBe("SUBMITTED");
    const freshClaim = await db.paymentClaim.findUniqueOrThrow({ where: { id: claim.id } });
    expect(freshClaim.status).toBe("PENDING_REVIEW");
  });

  it("an ADMIN session confirms the claim for real", async () => {
    const { order, claim } = await makeSubmittedOrder();
    vi.mocked(requireAdmin).mockResolvedValueOnce(ADMIN);

    await expect(
      decideClaimAction(
        { status: "idle" },
        formData({
          claimId: claim.id,
          orderReference: order.reference,
          matchedAmountKwacha: "150.00",
        }),
      ),
    ).rejects.toThrow(/NEXT_REDIRECT/);

    const freshOrder = await db.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(freshOrder.paymentState).toBe("CONFIRMED");
    const freshClaim = await db.paymentClaim.findUniqueOrThrow({ where: { id: claim.id } });
    expect(freshClaim.status).toBe("ACCEPTED");
    expect(freshClaim.reviewedById).toBe(ADMIN.id);
  });
});

describe("rejectClaimAction", () => {
  it("a STAFF (forbidden) session is refused and nothing changes", async () => {
    const { order, claim } = await makeSubmittedOrder();
    vi.mocked(requireAdmin).mockRejectedValueOnce(FORBIDDEN);

    await expect(
      rejectClaimAction(
        { status: "idle" },
        formData({
          claimId: claim.id,
          orderReference: order.reference,
          reasonCode: "reference_not_found",
        }),
      ),
    ).rejects.toBe(FORBIDDEN);

    const freshOrder = await db.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(freshOrder.paymentState).toBe("SUBMITTED");
  });

  it("an ADMIN session rejects the claim for real", async () => {
    const { order, claim } = await makeSubmittedOrder();
    vi.mocked(requireAdmin).mockResolvedValueOnce(ADMIN);

    await expect(
      rejectClaimAction(
        { status: "idle" },
        formData({
          claimId: claim.id,
          orderReference: order.reference,
          reasonCode: "reference_not_found",
        }),
      ),
    ).rejects.toThrow(/NEXT_REDIRECT/);

    const freshOrder = await db.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(freshOrder.paymentState).toBe("REJECTED");
  });
});

describe("reopenOrderAction", () => {
  async function makeExpiredOrder() {
    const order = await makeOrder();
    await db.$transaction((tx) => transitionPayment(tx, order.id, "EXPIRED", { type: "SYSTEM" }));
    return db.order.findUniqueOrThrow({ where: { id: order.id } });
  }

  it("a STAFF (forbidden) session is refused and nothing changes", async () => {
    const order = await makeExpiredOrder();
    vi.mocked(requireAdmin).mockRejectedValueOnce(FORBIDDEN);

    await expect(
      reopenOrderAction(
        { status: "idle" },
        formData({ orderId: order.id, orderReference: order.reference }),
      ),
    ).rejects.toBe(FORBIDDEN);

    const fresh = await db.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(fresh.paymentExpiresAt.getTime()).toBe(order.paymentExpiresAt.getTime());
  });

  it("an ADMIN session extends the expiry for real", async () => {
    const order = await makeExpiredOrder();
    vi.mocked(requireAdmin).mockResolvedValueOnce(ADMIN);

    await expect(
      reopenOrderAction(
        { status: "idle" },
        formData({ orderId: order.id, orderReference: order.reference }),
      ),
    ).rejects.toThrow(/NEXT_REDIRECT/);

    const fresh = await db.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(fresh.paymentState).toBe("EXPIRED");
    expect(fresh.paymentExpiresAt.getTime()).toBeGreaterThan(order.paymentExpiresAt.getTime());
  });
});
