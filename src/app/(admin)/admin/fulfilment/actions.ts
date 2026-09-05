"use server";

import { revalidatePath } from "next/cache";
import { FulfilmentState } from "@/generated/prisma/client";
import { requireAdmin } from "@/lib/auth/guards";
import { advancePrintItem } from "@/lib/services/print-fulfilment";

// Every action starts with requireAdmin() (CLAUDE.md Rule 5) — the (admin)
// layout gates the group too, but an action must never rely on that alone.
// advancePrintItem() takes no role: authorization is deliberately this layer's
// job (see print-fulfilment.ts).

export type FulfilmentFormState =
  | { status: "idle" }
  | { status: "error"; formError: string };

const VALID_TARGETS = new Set<string>([
  FulfilmentState.PACKED,
  FulfilmentState.DISPATCHED,
  FulfilmentState.DELIVERED,
  FulfilmentState.RETURNED,
]);

function str(fd: FormData, key: string): string {
  const v = fd.get(key);
  return typeof v === "string" ? v : "";
}

export async function advancePrintItemAction(
  _prev: FulfilmentFormState,
  formData: FormData,
): Promise<FulfilmentFormState> {
  const admin = await requireAdmin();

  const orderItemId = str(formData, "orderItemId");
  const to = str(formData, "to");
  if (!orderItemId || !VALID_TARGETS.has(to)) {
    return { status: "error", formError: "Something was missing — try again." };
  }

  const result = await advancePrintItem({
    orderItemId,
    to: to as FulfilmentState,
    actorId: admin.id,
    trackingNote: to === FulfilmentState.DISPATCHED ? str(formData, "trackingNote") : undefined,
  });

  if (!result.ok) {
    const message =
      result.error === "conflict"
        ? "That order has already moved on."
        : result.error === "order_not_confirmed"
          ? "This order's payment isn't confirmed — it can't be packed."
          : "That item is no longer available to move.";
    return { status: "error", formError: message };
  }

  revalidatePath("/admin/fulfilment");
  return { status: "idle" };
}
