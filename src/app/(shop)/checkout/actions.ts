"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createOrder, type CreateOrderInput } from "@/lib/services/orders";

// PUBLIC BY DESIGN. There is deliberately no requireAdmin()/requireStaff() here —
// buyers are not signed in. createOrder() does all validation and never trusts a
// price from the caller (the input type has no price field). Do not "fix" this
// by adding an auth guard.

export type CheckoutValues = {
  name: string;
  email: string;
  phone: string;
  deliveryZone: string;
  deliveryAddress: string;
};

export type CheckoutState =
  | { status: "idle" }
  | {
      status: "error";
      formError?: string;
      issues?: Partial<Record<keyof CheckoutValues, string>>;
      values: CheckoutValues;
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

// createOrder issue keys -> checkout form field names.
const ISSUE_KEY: Record<string, keyof CheckoutValues> = {
  customerName: "name",
  customerEmail: "email",
  customerPhone: "phone",
  deliveryZone: "deliveryZone",
  deliveryAddress: "deliveryAddress",
};

export async function checkoutAction(
  _prev: CheckoutState,
  formData: FormData,
): Promise<CheckoutState> {
  const values: CheckoutValues = {
    name: str(formData, "name"),
    email: str(formData, "email"),
    phone: str(formData, "phone"),
    deliveryZone: str(formData, "deliveryZone"),
    deliveryAddress: str(formData, "deliveryAddress"),
  };

  const input: CreateOrderInput = {
    bookFormatId: str(formData, "bookFormatId"),
    quantity: 1,
    customerName: values.name,
    customerEmail: values.email,
    customerPhone: values.phone,
    deliveryZone: values.deliveryZone
      ? (values.deliveryZone as CreateOrderInput["deliveryZone"])
      : null,
    deliveryAddress: values.deliveryAddress || null,
    creationIp: await clientIp(),
  };

  const result = await createOrder(input);

  if (result.ok) {
    redirect(`/orders/${result.order.reference}/pay?t=${result.order.accessToken}`);
  }

  switch (result.error) {
    case "invalid_input": {
      const issues: Partial<Record<keyof CheckoutValues, string>> = {};
      for (const [key, message] of Object.entries(result.issues)) {
        const field = ISSUE_KEY[key];
        if (field && !issues[field]) issues[field] = message;
      }
      return {
        status: "error",
        issues,
        formError: Object.keys(issues).length
          ? "Check the highlighted fields and try again."
          : "Something in the form wasn't right. Check it and try again.",
        values,
      };
    }
    case "format_not_found":
    case "format_unavailable":
      return {
        status: "error",
        formError: "This book or format isn't available to buy right now.",
        values,
      };
    case "out_of_stock":
      return {
        status: "error",
        formError:
          "That book is out of stock. Try the ebook, or check back soon.",
        values,
      };
    case "delivery_zone_required":
      return {
        status: "error",
        issues: { deliveryZone: "Choose how you'd like to receive it." },
        formError: "Choose how you'd like to receive it.",
        values,
      };
    case "delivery_address_required":
      return {
        status: "error",
        issues: { deliveryAddress: "Enter the delivery address." },
        formError: "Enter the delivery address.",
        values,
      };
    case "delivery_not_applicable":
      return {
        status: "error",
        formError: "An ebook has nothing to deliver — reload the page and try again.",
        values,
      };
    case "rate_limited":
      return {
        status: "error",
        formError:
          "Too many orders from this connection in the last hour. Wait a little and try again.",
        values,
      };
    default:
      return {
        status: "error",
        formError: "That order couldn't be created. Try again.",
        values,
      };
  }
}
