"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { isCloudinaryConfigured, uploadReceiptImage } from "@/lib/cloudinary";
import { submitClaim } from "@/lib/services/claims";

// PUBLIC BY DESIGN. No requireAdmin()/requireStaff() — buyers are not signed in.
// submitClaim() validates the order's accessToken and runs every other check.
// Do not "fix" this by adding an auth guard.

export type ClaimValues = {
  network: string;
  senderPhone: string;
  transactionId: string;
};

export type ClaimState =
  | { status: "idle" }
  | {
      status: "error";
      formError?: string;
      issues?: Partial<Record<keyof ClaimValues, string>>;
      values: ClaimValues;
    };

function str(fd: FormData, key: string): string {
  const v = fd.get(key);
  return typeof v === "string" ? v.trim() : "";
}

async function clientIp(): Promise<string | null> {
  const h = await headers();
  const fwd = h.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]!.trim();
  return h.get("x-real-ip");
}

export async function submitClaimAction(
  _prev: ClaimState,
  formData: FormData,
): Promise<ClaimState> {
  const orderReference = str(formData, "orderReference");
  const accessToken = str(formData, "accessToken");
  const values: ClaimValues = {
    network: str(formData, "network"),
    senderPhone: str(formData, "senderPhone"),
    transactionId: str(formData, "transactionId"),
  };

  let receiptImageUrl: string | null = null;
  const receipt = formData.get("receipt");
  if (receipt instanceof File && receipt.size > 0 && isCloudinaryConfigured()) {
    const uploaded = await uploadReceiptImage(receipt);
    if (!uploaded.ok) {
      return {
        status: "error",
        formError: `${uploaded.error} You can also send without a screenshot.`,
        values,
      };
    }
    receiptImageUrl = uploaded.url;
  }

  const result = await submitClaim({
    orderReference,
    accessToken,
    network: values.network,
    senderPhone: values.senderPhone,
    transactionId: values.transactionId,
    receiptImageUrl,
    ip: await clientIp(),
  });

  if (result.ok) {
    redirect(
      `/orders/${orderReference}?t=${encodeURIComponent(accessToken)}&submitted=1`,
    );
  }

  switch (result.error) {
    case "invalid_input": {
      const issues: Partial<Record<keyof ClaimValues, string>> = {};
      for (const k of ["network", "senderPhone", "transactionId"] as const) {
        if (result.issues[k]) issues[k] = result.issues[k];
      }
      return {
        status: "error",
        issues,
        formError: "Check the highlighted fields and try again.",
        values,
      };
    }
    case "order_not_found":
      return {
        status: "error",
        formError: "We couldn't match this order. Open your order link again.",
        values,
      };
    case "not_awaiting_payment":
      return {
        status: "error",
        formError:
          "This order isn't waiting for a payment reference right now. Check its status.",
        values,
      };
    case "duplicate_reference":
      return {
        status: "error",
        formError:
          "This transaction reference has already been submitted. Contact us if you think this is a mistake.",
        values,
      };
    case "rate_limited":
      return {
        status: "error",
        formError:
          "You've sent this a few times already. Give us a little time to check the last one.",
        values,
      };
    default:
      return {
        status: "error",
        formError: "That couldn't be submitted. Try again.",
        values,
      };
  }
}
