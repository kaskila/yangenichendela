import { z } from "zod";
import { db } from "@/lib/db";
import {
  Prisma,
  MerchantAccountType,
  MobileNetwork,
} from "@/generated/prisma/client";
import type { MerchantNumber, StoreSettings } from "@/generated/prisma/client";
import { parseKwachaToMinor } from "@/lib/money";

// Admin store configuration: the singleton StoreSettings row (delivery fee) and
// the MerchantNumber list shown on the payment instructions page.
//
// CLAUDE.md rules honoured here:
//   - Rule 2: the delivery fee is parsed only via parseKwachaToMinor(); no
//     ad-hoc kwacha -> ngwee conversion.
//   - Rule 8: no hard delete. isActive is the toggle for a number that must
//     stop being offered.
// No authorization here — the /admin/settings actions call requireAdmin().

const SINGLETON_ID = "singleton";

export type FieldIssues = Record<string, string>;

// --- store settings --------------------------------------------------------

/** The one settings row, materialised with schema defaults on first access. */
export function getStoreSettings(): Promise<StoreSettings> {
  return db.storeSettings.upsert({
    where: { id: SINGLETON_ID },
    create: {},
    update: {},
  });
}

export type UpdateDeliveryResult =
  | { ok: true; settings: StoreSettings }
  | { ok: false; error: string };

export async function updateDeliveryLusakaMinor(
  rawKwacha: string,
): Promise<UpdateDeliveryResult> {
  const parsed = parseKwachaToMinor(rawKwacha);
  if (!parsed.ok) return { ok: false, error: parsed.error };

  const settings = await db.storeSettings.upsert({
    where: { id: SINGLETON_ID },
    create: { deliveryLusakaMinor: parsed.minor },
    update: { deliveryLusakaMinor: parsed.minor },
  });
  return { ok: true, settings };
}

// --- merchant numbers -----------------------------------------------------

export type MerchantNumberDraft = {
  network: string;
  number: string;
  accountName: string;
  label: string;
  accountType: string;
  isActive: boolean;
  isPrimary: boolean;
};

export type MerchantWriteResult =
  | { ok: true; id: string }
  | { ok: false; error: "invalid_input"; issues: FieldIssues }
  | { ok: false; error: "number_taken" }
  | { ok: false; error: "not_found" };

const merchantSchema = z
  .object({
    network: z.enum([
      MobileNetwork.AIRTEL,
      MobileNetwork.MTN,
      MobileNetwork.ZAMTEL,
    ]),
    // A merchant till / short code is not a phone number, so no normalisation —
    // just the characters those identifiers actually use.
    number: z
      .string()
      .trim()
      .min(4, "Enter the number.")
      .max(20, "That number is too long.")
      .regex(/^[0-9+\s-]+$/, "Use digits, spaces, + and - only."),
    accountName: z.string().trim().max(120, "That name is too long."),
    label: z.string().trim().max(60, "That label is too long."),
    accountType: z.enum([
      MerchantAccountType.PERSONAL,
      MerchantAccountType.MERCHANT,
    ]),
    isActive: z.boolean(),
    isPrimary: z.boolean(),
  })
  .refine((v) => !(v.isPrimary && !v.isActive), {
    error: "A primary number must be active.",
    path: ["isPrimary"],
  });

type ValidMerchant = z.infer<typeof merchantSchema>;

function toData(v: ValidMerchant) {
  return {
    network: v.network,
    number: v.number,
    accountName: v.accountName || null,
    label: v.label || null,
    accountType: v.accountType,
    isActive: v.isActive,
    isPrimary: v.isPrimary,
  };
}

function isNumberTaken(error: unknown): boolean {
  // MerchantNumber has exactly one unique constraint — @@unique([network,
  // number]) — so any P2002 on a write here is a duplicate number. No need to
  // identify the constraint (which the Prisma 7 pg adapter makes awkward).
  return (
    error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002"
  );
}

/** Clear isPrimary on every OTHER number for this network. */
async function demoteSiblings(
  tx: Prisma.TransactionClient,
  network: MobileNetwork,
  keepId: string,
): Promise<void> {
  await tx.merchantNumber.updateMany({
    where: { network, isPrimary: true, id: { not: keepId } },
    data: { isPrimary: false },
  });
}

export function listMerchantNumbers(): Promise<MerchantNumber[]> {
  return db.merchantNumber.findMany({
    orderBy: [{ network: "asc" }, { isPrimary: "desc" }, { createdAt: "asc" }],
  });
}

/** The numbers shown to buyers on the payment instructions page: one per
 *  network, active and marked primary. */
export function getActivePrimaryMerchantNumbers(): Promise<MerchantNumber[]> {
  return db.merchantNumber.findMany({
    where: { isActive: true, isPrimary: true },
    orderBy: { network: "asc" },
  });
}

export function getMerchantNumber(id: string): Promise<MerchantNumber | null> {
  return db.merchantNumber.findUnique({ where: { id } });
}

export async function createMerchantNumber(
  draft: MerchantNumberDraft,
): Promise<MerchantWriteResult> {
  const parsed = merchantSchema.safeParse(draft);
  if (!parsed.success) {
    return { ok: false, error: "invalid_input", issues: flatten(parsed.error) };
  }
  const v = parsed.data;

  try {
    return await db.$transaction(async (tx) => {
      const row = await tx.merchantNumber.create({ data: toData(v) });
      if (v.isPrimary) await demoteSiblings(tx, v.network, row.id);
      return { ok: true, id: row.id } as const;
    });
  } catch (error) {
    if (isNumberTaken(error)) return { ok: false, error: "number_taken" };
    throw error;
  }
}

export async function updateMerchantNumber(
  id: string,
  draft: MerchantNumberDraft,
): Promise<MerchantWriteResult> {
  const parsed = merchantSchema.safeParse(draft);
  if (!parsed.success) {
    return { ok: false, error: "invalid_input", issues: flatten(parsed.error) };
  }
  const v = parsed.data;

  const existing = await db.merchantNumber.findUnique({ where: { id } });
  if (!existing) return { ok: false, error: "not_found" };

  try {
    return await db.$transaction(async (tx) => {
      await tx.merchantNumber.update({ where: { id }, data: toData(v) });
      if (v.isPrimary) await demoteSiblings(tx, v.network, id);
      return { ok: true, id } as const;
    });
  } catch (error) {
    if (isNumberTaken(error)) return { ok: false, error: "number_taken" };
    throw error;
  }
}

/** Soft toggle (Rule 8 — never a hard delete). Deactivating also clears
 *  isPrimary: an inactive primary would still be shown to buyers otherwise. */
export async function setMerchantNumberActive(
  id: string,
  isActive: boolean,
): Promise<MerchantWriteResult> {
  const existing = await db.merchantNumber.findUnique({ where: { id } });
  if (!existing) return { ok: false, error: "not_found" };

  await db.merchantNumber.update({
    where: { id },
    data: { isActive, ...(isActive ? {} : { isPrimary: false }) },
  });
  return { ok: true, id };
}

function flatten(error: z.ZodError): FieldIssues {
  const issues: FieldIssues = {};
  for (const issue of error.issues) {
    const key = issue.path.map(String).join(".") || "form";
    if (!(key in issues)) issues[key] = issue.message;
  }
  return issues;
}
