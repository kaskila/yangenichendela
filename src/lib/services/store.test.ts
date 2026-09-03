import { afterAll, afterEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import {
  createMerchantNumber,
  getStoreSettings,
  listMerchantNumbers,
  setMerchantNumberActive,
  updateDeliveryLusakaMinor,
  type MerchantNumberDraft,
} from "@/lib/services/store";

// Integration tests against the real .env.test database. The invariant most
// worth guarding: exactly one primary number per network.

let seq = 0;

function draft(over: Partial<MerchantNumberDraft> = {}): MerchantNumberDraft {
  return {
    network: "AIRTEL",
    number: `0970${String(100000 + seq++).slice(-6)}`,
    accountName: "Y Chendela",
    label: "test",
    accountType: "PERSONAL",
    isActive: true,
    isPrimary: false,
    ...over,
  };
}

afterEach(async () => {
  await db.merchantNumber.deleteMany({ where: { label: "test" } });
});

afterAll(async () => {
  await db.merchantNumber.deleteMany({ where: { label: "test" } });
  await db.storeSettings.upsert({
    where: { id: "singleton" },
    create: { deliveryLusakaMinor: 5000 },
    update: { deliveryLusakaMinor: 5000 },
  });
  await db.$disconnect();
});

describe("merchant numbers — one primary per network", () => {
  it("setting a new primary clears the primary flag on siblings, not other networks", async () => {
    const a = await createMerchantNumber(draft({ network: "AIRTEL", isPrimary: true }));
    const mtn = await createMerchantNumber(draft({ network: "MTN", isPrimary: true }));
    expect(a.ok && mtn.ok).toBe(true);

    const b = await createMerchantNumber(draft({ network: "AIRTEL", isPrimary: true }));
    expect(b.ok).toBe(true);

    const rows = await listMerchantNumbers();
    const airtelPrimary = rows.filter((r) => r.network === "AIRTEL" && r.isPrimary);
    const mtnPrimary = rows.filter((r) => r.network === "MTN" && r.isPrimary);
    expect(airtelPrimary).toHaveLength(1);
    if (b.ok) expect(airtelPrimary[0].id).toBe(b.id);
    expect(mtnPrimary).toHaveLength(1); // untouched
  });

  it("deactivating a primary number clears its primary flag", async () => {
    const created = await createMerchantNumber(draft({ isPrimary: true }));
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const result = await setMerchantNumberActive(created.id, false);
    expect(result.ok).toBe(true);

    const row = await db.merchantNumber.findUniqueOrThrow({ where: { id: created.id } });
    expect(row.isActive).toBe(false);
    expect(row.isPrimary).toBe(false);
  });

  it("refuses to mark an inactive number primary", async () => {
    const result = await createMerchantNumber(
      draft({ isActive: false, isPrimary: true }),
    );
    expect(result.ok).toBe(false);
    if (result.ok || result.error !== "invalid_input") throw new Error("expected invalid_input");
    expect(result.issues.isPrimary).toBeDefined();
  });

  it("rejects a duplicate [network, number] with number_taken", async () => {
    const d = draft({ number: "0971234567" });
    const first = await createMerchantNumber(d);
    expect(first.ok).toBe(true);
    const second = await createMerchantNumber(d);
    expect(second).toEqual({ ok: false, error: "number_taken" });
  });
});

describe("delivery fee — money.ts only", () => {
  it("parses a kwacha string to exact ngwee", async () => {
    const result = await updateDeliveryLusakaMinor("75.00");
    expect(result.ok).toBe(true);
    const settings = await getStoreSettings();
    expect(settings.deliveryLusakaMinor).toBe(7500);
  });

  it("rejects a non-numeric fee and leaves the value unchanged", async () => {
    await updateDeliveryLusakaMinor("40.00");
    const bad = await updateDeliveryLusakaMinor("abc");
    expect(bad.ok).toBe(false);
    const settings = await getStoreSettings();
    expect(settings.deliveryLusakaMinor).toBe(4000);
  });
});

describe("getStoreSettings", () => {
  it("returns the same singleton row on repeated calls", async () => {
    const a = await getStoreSettings();
    const b = await getStoreSettings();
    expect(a.id).toBe("singleton");
    expect(b.id).toBe("singleton");
    const count = await db.storeSettings.count();
    expect(count).toBe(1);
  });
});
