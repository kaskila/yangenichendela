"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth/guards";
import { PaymentTransitionError } from "@/lib/payments/transitions";
import {
  decideClaim,
  rejectClaim,
  reopenOrder,
  type FieldIssues,
} from "@/lib/services/claim-review";

// Every action here starts with requireAdmin() (CLAUDE.md Rule 5) — the
// (admin) layout also gates the whole route group, but an action must never
// rely on that alone. The services these call take no role: authorization is
// deliberately this layer's job (see claim-review.ts).

export type DecideFormState =
  | { status: "idle" }
  | { status: "error"; formError?: string; issues?: FieldIssues };

export type RejectFormState =
  | { status: "idle" }
  | { status: "error"; formError?: string; issues?: FieldIssues };

export type ReopenFormState = { status: "idle" } | { status: "error"; formError: string };

function str(fd: FormData, key: string): string {
  const v = fd.get(key);
  return typeof v === "string" ? v : "";
}

function revalidateOrder(reference: string): void {
  revalidatePath("/admin/orders");
  revalidatePath(`/admin/orders/${reference}`);
}

export async function decideClaimAction(
  _prev: DecideFormState,
  formData: FormData,
): Promise<DecideFormState> {
  const admin = await requireAdmin();

  const claimId = str(formData, "claimId");
  const orderReference = str(formData, "orderReference");
  if (!claimId || !orderReference) {
    return { status: "error", formError: "Missing claim reference." };
  }

  let result;
  try {
    result = await decideClaim({
      claimId,
      matchedAmountKwacha: str(formData, "matchedAmountKwacha"),
      reviewNote: str(formData, "reviewNote"),
      actorId: admin.id,
    });
  } catch (error) {
    // The concurrency case (docs §5.7): whichever admin loses the race can
    // see EITHER error depending on timing — both mean the same thing to the
    // person looking at the screen.
    if (error instanceof PaymentTransitionError) {
      return { status: "error", formError: "Someone already confirmed this order." };
    }
    throw error;
  }

  if (!result.ok) {
    if (result.error === "invalid_input") {
      return { status: "error", issues: result.issues };
    }
    if (result.error === "already_reviewed") {
      return { status: "error", formError: "This claim has already been decided." };
    }
    return { status: "error", formError: "That claim no longer exists." };
  }

  revalidateOrder(orderReference);
  redirect(`/admin/orders/${orderReference}`);
}

export async function rejectClaimAction(
  _prev: RejectFormState,
  formData: FormData,
): Promise<RejectFormState> {
  const admin = await requireAdmin();

  const claimId = str(formData, "claimId");
  const orderReference = str(formData, "orderReference");
  if (!claimId || !orderReference) {
    return { status: "error", formError: "Missing claim reference." };
  }

  let result;
  try {
    result = await rejectClaim({
      claimId,
      reasonCode: str(formData, "reasonCode"),
      note: str(formData, "note"),
      actorId: admin.id,
    });
  } catch (error) {
    if (error instanceof PaymentTransitionError) {
      return { status: "error", formError: "Someone already decided this claim." };
    }
    throw error;
  }

  if (!result.ok) {
    if (result.error === "invalid_input") {
      return { status: "error", issues: result.issues };
    }
    if (result.error === "already_reviewed") {
      return { status: "error", formError: "This claim has already been decided." };
    }
    return { status: "error", formError: "That claim no longer exists." };
  }

  revalidateOrder(orderReference);
  redirect(`/admin/orders/${orderReference}`);
}

export async function reopenOrderAction(
  _prev: ReopenFormState,
  formData: FormData,
): Promise<ReopenFormState> {
  const admin = await requireAdmin();

  const orderId = str(formData, "orderId");
  const orderReference = str(formData, "orderReference");
  if (!orderId || !orderReference) {
    return { status: "error", formError: "Missing order reference." };
  }

  const result = await reopenOrder({ orderId, actorId: admin.id });
  if (!result.ok) {
    return { status: "error", formError: "This order is no longer expired." };
  }

  revalidateOrder(orderReference);
  redirect(`/admin/orders/${orderReference}`);
}
