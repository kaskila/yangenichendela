"use server";

import { revalidatePath } from "next/cache";
import { regenerateDownloadToken } from "@/lib/services/fulfilment";

// PUBLIC BY DESIGN. No requireAdmin/requireStaff — buyers are not signed in.
// regenerateDownloadToken() validates the order's accessToken itself, same
// pattern as pay/actions.ts's submitClaimAction. Do not "fix" this by adding
// an auth guard.

export type RegenerateDownloadState =
  | { status: "idle" }
  | { status: "saved" }
  | { status: "error"; error: string };

function str(fd: FormData, key: string): string {
  const v = fd.get(key);
  return typeof v === "string" ? v : "";
}

export async function regenerateDownloadTokenAction(
  _prev: RegenerateDownloadState,
  formData: FormData,
): Promise<RegenerateDownloadState> {
  const orderReference = str(formData, "orderReference");
  const accessToken = str(formData, "accessToken");
  const orderItemId = str(formData, "orderItemId");

  const result = await regenerateDownloadToken({ orderReference, accessToken, orderItemId });
  if (!result.ok) {
    return {
      status: "error",
      error: "That didn't work. Reopen your order link and try again.",
    };
  }

  revalidatePath(`/orders/${orderReference}`);
  return { status: "saved" };
}
