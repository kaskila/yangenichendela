"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth/guards";
import {
  createMerchantNumber,
  setMerchantNumberActive,
  updateDeliveryLusakaMinor,
  updateMerchantNumber,
  type FieldIssues,
  type MerchantNumberDraft,
} from "@/lib/services/store";

export type DeliveryFormState =
  | { status: "idle" }
  | { status: "saved" }
  | { status: "error"; error: string };

export type MerchantFormState =
  | { status: "idle" }
  | { status: "saved" }
  | { status: "error"; formError?: string; issues?: FieldIssues };

function str(fd: FormData, key: string): string {
  const v = fd.get(key);
  return typeof v === "string" ? v : "";
}

function checked(fd: FormData, key: string): boolean {
  const v = fd.get(key);
  return v === "on" || v === "true";
}

function readMerchantDraft(fd: FormData): MerchantNumberDraft {
  return {
    network: str(fd, "network"),
    number: str(fd, "number"),
    accountName: str(fd, "accountName"),
    label: str(fd, "label"),
    accountType: str(fd, "accountType"),
    isActive: checked(fd, "isActive"),
    isPrimary: checked(fd, "isPrimary"),
  };
}

export async function saveDeliveryFeeAction(
  _prev: DeliveryFormState,
  formData: FormData,
): Promise<DeliveryFormState> {
  await requireAdmin();

  const result = await updateDeliveryLusakaMinor(str(formData, "deliveryLusaka"));
  if (!result.ok) return { status: "error", error: result.error };

  revalidatePath("/admin/settings");
  return { status: "saved" };
}

export async function createMerchantNumberAction(
  _prev: MerchantFormState,
  formData: FormData,
): Promise<MerchantFormState> {
  await requireAdmin();

  const result = await createMerchantNumber(readMerchantDraft(formData));
  if (result.ok) {
    revalidatePath("/admin/settings");
    redirect("/admin/settings");
  }
  return merchantError(result);
}

export async function updateMerchantNumberAction(
  _prev: MerchantFormState,
  formData: FormData,
): Promise<MerchantFormState> {
  await requireAdmin();

  const id = str(formData, "id");
  if (!id) return { status: "error", formError: "Missing number reference." };

  const result = await updateMerchantNumber(id, readMerchantDraft(formData));
  if (result.ok) {
    revalidatePath("/admin/settings");
    revalidatePath(`/admin/settings/${id}`);
    return { status: "saved" };
  }
  return merchantError(result);
}

export async function setMerchantNumberActiveAction(
  formData: FormData,
): Promise<void> {
  await requireAdmin();

  const id = str(formData, "id");
  if (!id) return;
  await setMerchantNumberActive(id, str(formData, "active") === "true");
  revalidatePath("/admin/settings");
}

function merchantError(
  result: Exclude<Awaited<ReturnType<typeof createMerchantNumber>>, { ok: true }>,
): MerchantFormState {
  if (result.error === "number_taken") {
    return {
      status: "error",
      issues: { number: "That number is already saved for this network." },
    };
  }
  if (result.error === "invalid_input") {
    return { status: "error", issues: result.issues };
  }
  return { status: "error", formError: "That number no longer exists." };
}
