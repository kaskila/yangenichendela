import { z } from "zod";
import { db } from "@/lib/db";
import { Prisma, DeliveryZone } from "@/generated/prisma/client";
import type { Order, OrderItem } from "@/generated/prisma/client";
import { recordOrderEvent } from "@/lib/payments/transitions";

// Order creation. Mirrors src/lib/services/registration.ts: a Zod schema at the
// front, discriminated-union results for ordinary outcomes (throwing is reserved
// for genuine faults), and NO authorization here — the checkout server action
// that will call this is deliberately public, and requireAdmin/requireStaff
// belong to the action layer.
//
// CLAUDE.md rules honoured here:
//   - Rule 2: money is integer minor units; subtotal is computed from the
//     STORED priceMinor, never a value from the caller. The input type has no
//     price field, so a smuggled price cannot even be referenced.
//   - Rule 3: the order is created at the schema default PENDING. Nothing here
//     writes paymentState.
//   - Rule 6: an "order.created" OrderEvent is written in the same transaction.
//   - Rule 7: titleSnapshot / formatSnapshot / unitPriceMinor are snapshotted
//     onto OrderItem so a later price change cannot rewrite order history.

// --- reference + access token ------------------------------------------------
// The reference is typed into a phone keypad and read aloud, so the alphabet
// drops 0/O and 1/I/L. Same approach as generateCode() in registration.ts, kept
// local rather than shared (sharing would mean editing registration.ts).

const REFERENCE_PREFIX = "YC-";
const REFERENCE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const REFERENCE_LENGTH = 5;
const CREATE_MAX_ATTEMPTS = 5;

export const REFERENCE_PATTERN = /^YC-[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{5}$/;

function generateReference(): string {
  const n = REFERENCE_ALPHABET.length;
  const limit = Math.floor(0x1_0000_0000 / n) * n; // reject modulo-biasing tail
  const buf = new Uint32Array(1);
  let body = "";
  while (body.length < REFERENCE_LENGTH) {
    crypto.getRandomValues(buf);
    if (buf[0] >= limit) continue;
    body += REFERENCE_ALPHABET[buf[0] % n];
  }
  return REFERENCE_PREFIX + body;
}

function generateAccessToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Buffer.from(bytes).toString("base64url");
}

// --- config -----------------------------------------------------------------

const RATE_LIMIT_PER_IP = 10;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;
const PAYMENT_WINDOW_MS = 48 * 60 * 60 * 1000; // generous by design

// --- input -----------------------------------------------------------------

export type CreateOrderInput = {
  bookFormatId: string;
  quantity: number;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  deliveryZone?: DeliveryZone | null;
  deliveryAddress?: string | null;
  /** For per-IP order-creation rate limiting (spec 5.12). */
  creationIp?: string | null;
};

export type FieldIssues = Record<string, string>;

export type OrderWithItems = Order & { items: OrderItem[] };

export type CreateOrderResult =
  | { ok: true; order: OrderWithItems }
  | { ok: false; error: "invalid_input"; issues: FieldIssues }
  | { ok: false; error: "format_not_found" }
  | { ok: false; error: "format_unavailable" }
  | { ok: false; error: "out_of_stock" }
  | { ok: false; error: "delivery_zone_required" }
  | { ok: false; error: "delivery_address_required" }
  | { ok: false; error: "delivery_not_applicable" }
  | { ok: false; error: "rate_limited" };

const inputSchema = z.object({
  bookFormatId: z.string().trim().min(1, "Choose a format."),
  quantity: z
    .number({ error: "Enter a quantity." })
    .int("Quantity must be a whole number.")
    .min(1, "Quantity must be at least 1.")
    .max(10, "Quantity cannot be more than 10."),
  customerName: z
    .string()
    .trim()
    .min(1, "Enter your name.")
    .max(200, "That name is too long.")
    .transform((s) => s.replace(/\s+/g, " ")),
  customerEmail: z
    .string()
    .trim()
    .toLowerCase()
    .pipe(z.email({ message: "Enter a valid email address." })),
  // Minimal phone validation: manual mobile money buyers are Zambian, but a
  // hard format rule is a business decision not yet made, and diaspora/card
  // buyers come later. Keep it permissive.
  customerPhone: z
    .string()
    .trim()
    .min(6, "Enter a phone number.")
    .max(20, "That phone number is too long."),
  deliveryZone: z
    .enum([DeliveryZone.LUSAKA, DeliveryZone.REST_OF_ZAMBIA, DeliveryZone.PICKUP])
    .nullish(),
  deliveryAddress: z
    .string()
    .trim()
    .max(500, "That address is too long.")
    .nullish(),
  creationIp: z.string().trim().max(64).nullish(),
});

function flattenIssues(error: z.ZodError): FieldIssues {
  const issues: FieldIssues = {};
  for (const issue of error.issues) {
    const key = issue.path.map(String).join(".") || "form";
    if (!(key in issues)) issues[key] = issue.message;
  }
  return issues;
}

// --- create ---------------------------------------------------------------

export async function createOrder(
  input: CreateOrderInput,
): Promise<CreateOrderResult> {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "invalid_input", issues: flattenIssues(parsed.error) };
  }
  const v = parsed.data;
  const address = v.deliveryAddress?.trim() ? v.deliveryAddress.trim() : null;

  return db.$transaction(async (tx) => {
    // 1. Rate limit. Cheap, low severity — a plain result, no CAPTCHA.
    if (v.creationIp) {
      const since = new Date(Date.now() - RATE_LIMIT_WINDOW_MS);
      const recent = await tx.order.count({
        where: { creationIp: v.creationIp, createdAt: { gte: since } },
      });
      if (recent >= RATE_LIMIT_PER_IP) {
        return { ok: false, error: "rate_limited" } as const;
      }
    }

    // 2. Load the format + its book. NEVER trust a price from the caller —
    //    priceMinor is read here and nowhere else.
    const format = await tx.bookFormat.findUnique({
      where: { id: v.bookFormatId },
      include: { book: true },
    });
    if (!format) return { ok: false, error: "format_not_found" } as const;
    if (!format.isAvailable || !format.book.published) {
      return { ok: false, error: "format_unavailable" } as const;
    }

    // 3. Stock (PRINT only; NULL stock = not tracked = unlimited).
    if (
      format.type === "PRINT" &&
      format.stockOnHand !== null &&
      format.stockOnHand < v.quantity
    ) {
      return { ok: false, error: "out_of_stock" } as const;
    }

    // 4. Delivery.
    let deliveryZone: DeliveryZone | null = null;
    let deliveryAddress: string | null = null;
    let deliveryMinor = 0;

    if (format.type === "EBOOK") {
      // Nothing to deliver — a zone or address here signals a client bug or
      // tampering, so reject rather than silently null it.
      if (v.deliveryZone || address) {
        return { ok: false, error: "delivery_not_applicable" } as const;
      }
    } else {
      if (!v.deliveryZone) {
        return { ok: false, error: "delivery_zone_required" } as const;
      }
      deliveryZone = v.deliveryZone;
      if (deliveryZone === DeliveryZone.PICKUP) {
        // Address is not collected for collection; ignore any that arrives.
        deliveryAddress = null;
        deliveryMinor = 0;
      } else {
        if (!address) {
          return { ok: false, error: "delivery_address_required" } as const;
        }
        deliveryAddress = address;
        if (deliveryZone === DeliveryZone.LUSAKA) {
          const settings = await tx.storeSettings.upsert({
            where: { id: "singleton" },
            create: {},
            update: {},
          });
          deliveryMinor = settings.deliveryLusakaMinor;
        } else {
          // REST_OF_ZAMBIA — buyer arranges carriage.
          deliveryMinor = 0;
        }
      }
    }

    // 5. Money. Both operands are integers, so this is exact (Rule 2).
    const subtotalMinor = format.priceMinor * v.quantity;
    const totalMinor = subtotalMinor + deliveryMinor;
    if (!Number.isSafeInteger(totalMinor)) {
      // priceMinor is bounded by money.ts and quantity <= 10, so this is a
      // genuine fault, not a user outcome.
      throw new Error(`orders: order total ${totalMinor} is not a safe integer`);
    }

    // 6. Create, retrying on a reference / accessToken collision.
    let order: OrderWithItems | null = null;
    for (let attempt = 0; attempt < CREATE_MAX_ATTEMPTS; attempt++) {
      try {
        order = await tx.order.create({
          data: {
            reference: generateReference(),
            accessToken: generateAccessToken(),
            customerName: v.customerName,
            customerEmail: v.customerEmail,
            customerPhone: v.customerPhone,
            creationIp: v.creationIp ?? null,
            currency: format.currency,
            subtotalMinor,
            deliveryMinor,
            totalMinor,
            paymentExpiresAt: new Date(Date.now() + PAYMENT_WINDOW_MS),
            deliveryZone,
            deliveryAddress,
            items: {
              create: [
                {
                  bookFormatId: format.id,
                  titleSnapshot: format.book.title,
                  formatSnapshot: format.type,
                  unitPriceMinor: format.priceMinor,
                  currency: format.currency,
                  quantity: v.quantity,
                },
              ],
            },
          },
          include: { items: true },
        });
        break;
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === "P2002"
        ) {
          continue; // reference or accessToken clash — regenerate both, retry
        }
        throw error;
      }
    }
    if (!order) {
      throw new Error("orders: exhausted attempts generating a unique reference");
    }

    // 7. Audit row, same transaction (Rule 6). actorType BUYER — a buyer action.
    await recordOrderEvent(tx, {
      orderId: order.id,
      type: "order.created",
      actor: { type: "BUYER" },
      metadata: {
        reference: order.reference,
        bookFormatId: format.id,
        quantity: v.quantity,
        subtotalMinor,
        deliveryMinor,
        totalMinor,
        ...(deliveryZone ? { deliveryZone } : {}),
      },
    });

    // 8. Side effects (instructions email) are the caller's job, after commit.
    return { ok: true, order } as const;
  });
}

// --- reads ----------------------------------------------------------------

/** Status / instructions page lookup by the human reference (case-insensitive). */
export function getOrderByReference(reference: string): Promise<OrderWithItems | null> {
  return db.order.findUnique({
    where: { reference: reference.trim().toUpperCase() },
    include: { items: true },
  });
}

/** Magic-link lookup by the opaque access token (exact match). */
export function getOrderByAccessToken(token: string): Promise<OrderWithItems | null> {
  return db.order.findUnique({
    where: { accessToken: token },
    include: { items: true },
  });
}
