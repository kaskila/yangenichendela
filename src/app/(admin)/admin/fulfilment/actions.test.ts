import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { minorToDecimalString } from "@/lib/money";
import { createOrder } from "@/lib/services/orders";
import { submitClaim, type SubmitClaimInput } from "@/lib/services/claims";
import { decideClaim } from "@/lib/services/claim-review";
import type { SessionUser } from "@/lib/auth";

// The only place Rule 5 ("every server action starts with requireAdmin()") is
// exercised against the action layer for the fulfilment queue — the service
// (print-fulfilment.ts) takes no role, so the STAFF-refusal test lives here.
// Same mock setup as admin/orders/actions.test.ts.

vi.mock("@/lib/auth/guards", () => ({
  requireAdmin: vi.fn(),
  requireStaff: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { requireAdmin } = await import("@/lib/auth/guards");
const { advancePrintItemAction } = await import("./actions");

const EMAIL_DOMAIN = "fulfilment-actions-test.local";
const SLUG_PREFIX = "fulfilment-actions-test-";
const FORBIDDEN = Object.assign(new Error("Forbidden"), { digest: "NEXT_HTTP_ERROR_FALLBACK;403" });

let ADMIN: SessionUser;
let seq = 0;
const txn = () => `TX${Date.now().toString(36)}${(seq++).toString(36)}XYZ`.toUpperCase();

async function makeAdminUser(): Promise<SessionUser> {
  const id = crypto.randomUUID();
  const user = await db.user.create({
    data: { id, name: "Test Admin", email: `admin-${id}@${EMAIL_DOMAIN}`, role: "ADMIN" },
  });
  return user as unknown as SessionUser;
}

async function makeConfirmedPrintItem() {
  const book = await db.book.create({
    data: {
      slug: `${SLUG_PREFIX}${crypto.randomUUID()}`,
      title: "Test Book",
      authorCredit: "TEST",
      description: "d",
      published: true,
      formats: { create: [{ type: "PRINT", priceMinor: 15000, isAvailable: true }] },
    },
    include: { formats: true },
  });
  const created = await createOrder({
    bookFormatId: book.formats[0]!.id,
    quantity: 1,
    customerName: "Test Buyer",
    customerEmail: `c-${crypto.randomUUID()}@${EMAIL_DOMAIN}`,
    customerPhone: "0977123456",
    deliveryZone: "PICKUP",
  });
  if (!created.ok) throw new Error(`order setup failed: ${JSON.stringify(created)}`);
  const order = created.order;

  const claimBody: SubmitClaimInput = {
    orderReference: order.reference,
    accessToken: order.accessToken,
    network: "AIRTEL",
    senderPhone: "0966123456",
    transactionId: txn(),
  };
  const claim = await submitClaim(claimBody);
  if (!claim.ok) throw new Error("claim setup failed");
  const decided = await decideClaim({
    claimId: claim.claim.id,
    matchedAmountKwacha: minorToDecimalString(order.totalMinor),
    actorId: ADMIN.id,
  });
  if (!decided.ok) throw new Error(`decide failed: ${JSON.stringify(decided)}`);

  const item = await db.orderItem.findFirstOrThrow({ where: { orderId: order.id } });
  return { order, item };
}

function formData(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [key, value] of Object.entries(fields)) fd.set(key, value);
  return fd;
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

beforeEach(async () => {
  vi.mocked(requireAdmin).mockReset();
  await wipe();
  ADMIN = await makeAdminUser();
});
afterAll(async () => {
  await wipe();
  await db.$disconnect();
});

describe("advancePrintItemAction", () => {
  it("a STAFF (forbidden) session is refused and the item does not move", async () => {
    const { item } = await makeConfirmedPrintItem();
    vi.mocked(requireAdmin).mockRejectedValueOnce(FORBIDDEN);

    await expect(
      advancePrintItemAction({ status: "idle" }, formData({ orderItemId: item.id, to: "PACKED" })),
    ).rejects.toBe(FORBIDDEN);

    const fresh = await db.orderItem.findUniqueOrThrow({ where: { id: item.id } });
    expect(fresh.fulfilmentState).toBe("AWAITING_PACKING");
  });

  it("an ADMIN session advances the item for real", async () => {
    const { order, item } = await makeConfirmedPrintItem();
    vi.mocked(requireAdmin).mockResolvedValueOnce(ADMIN);

    const state = await advancePrintItemAction(
      { status: "idle" },
      formData({ orderItemId: item.id, to: "PACKED" }),
    );
    expect(state).toEqual({ status: "idle" });

    const fresh = await db.orderItem.findUniqueOrThrow({ where: { id: item.id } });
    expect(fresh.fulfilmentState).toBe("PACKED");

    const events = await db.orderEvent.findMany({
      where: { orderId: order.id, type: "fulfilment.packed" },
    });
    expect(events).toHaveLength(1);
  });

  it("rejects an unknown target state without touching the item", async () => {
    const { item } = await makeConfirmedPrintItem();
    vi.mocked(requireAdmin).mockResolvedValueOnce(ADMIN);

    const state = await advancePrintItemAction(
      { status: "idle" },
      formData({ orderItemId: item.id, to: "AWAITING_PACKING" }),
    );
    expect(state.status).toBe("error");

    const fresh = await db.orderItem.findUniqueOrThrow({ where: { id: item.id } });
    expect(fresh.fulfilmentState).toBe("AWAITING_PACKING");
  });
});
