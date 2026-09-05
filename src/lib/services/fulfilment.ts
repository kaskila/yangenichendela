import { db } from "@/lib/db";
import type { DownloadToken } from "@/generated/prisma/client";
import { recordOrderEvent, type EventActor } from "@/lib/payments/transitions";
import { buildWatermarkText } from "@/lib/pdf-watermark";
import { slugify } from "@/lib/slug";
import { getOrderByReference } from "@/lib/services/orders";

// Confirmation-triggered fulfilment: issuing ebook download tokens and
// advancing print items into the packing queue. Separate from claims.ts
// (buyer submission) and claim-review.ts (claim decisions) — this file is
// about what happens to an ORDER once it is CONFIRMED, not how it got there.
//
// No authorization here, same as every other service — callers gate.

const TOKEN_EXPIRY_MS = 24 * 60 * 60 * 1000; // 24h, hygiene layer; the watermark is the real deterrent (docs §5.10)

function generateDownloadToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Buffer.from(bytes).toString("base64url");
}

// --- confirmation side effect (called from claim-review.ts, after commit) --

/**
 * Called once, strictly after the payment-confirmation transaction has
 * already committed (CLAUDE.md Rule 4 — a rolled-back transaction that had
 * already issued a token could not be undone). EBOOK items get a token and
 * DELIVERED_DIGITAL; PRINT items get AWAITING_PACKING only — the packing
 * QUEUE UI is a later slice, but the state flip on confirmation is not new
 * policy, it's the schema's own definition of that state ("Confirmed, in the
 * queue").
 */
export async function fulfilOrderOnConfirm(orderId: string): Promise<void> {
  await db.$transaction(async (tx) => {
    const items = await tx.orderItem.findMany({ where: { orderId } });

    for (const item of items) {
      if (item.formatSnapshot === "EBOOK") {
        const token = await tx.downloadToken.create({
          data: {
            token: generateDownloadToken(),
            orderId,
            orderItemId: item.id,
            expiresAt: new Date(Date.now() + TOKEN_EXPIRY_MS),
          },
        });
        await tx.orderItem.update({
          where: { id: item.id },
          data: { fulfilmentState: "DELIVERED_DIGITAL" },
        });
        await recordOrderEvent(tx, {
          orderId,
          type: "download.issued",
          actor: { type: "SYSTEM" },
          metadata: { orderItemId: item.id, downloadTokenId: token.id },
        });
      } else if (item.formatSnapshot === "PRINT") {
        await tx.orderItem.update({
          where: { id: item.id },
          data: { fulfilmentState: "AWAITING_PACKING" },
        });
      }
    }
  });
}

// --- refund hook (exported, not yet called from anywhere — see plan) ------

/**
 * The item-6 refund hook: revokes every still-active token for an order.
 * NOT wired to a transitionPayment(CONFIRMED -> REFUNDED) call anywhere yet
 * — no such trigger exists in the app (refund policy for digital goods is an
 * open client question per CLAUDE.md). This is ready for whichever future
 * slice adds one; call it immediately after that transition's transaction
 * commits, same discipline as fulfilOrderOnConfirm.
 */
export async function revokeActiveDownloadTokensForOrder(
  orderId: string,
  actor: EventActor,
): Promise<void> {
  await db.$transaction(async (tx) => {
    const result = await tx.downloadToken.updateMany({
      where: { orderId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (result.count > 0) {
      await recordOrderEvent(tx, {
        orderId,
        type: "download.revoked",
        actor,
        metadata: { count: result.count },
      });
    }
  });
}

// --- download route support -------------------------------------------

export type ResolveDownloadResult =
  | {
      ok: true;
      downloadTokenId: string;
      maxDownloads: number;
      ebookAssetUrl: string;
      filename: string;
      watermarkText: string;
      orderReference: string;
      accessToken: string;
    }
  | { ok: false; error: "not_found" }
  | { ok: false; error: "revoked"; orderReference: string; accessToken: string }
  | { ok: false; error: "expired"; orderReference: string; accessToken: string }
  | { ok: false; error: "limit_reached"; orderReference: string; accessToken: string };

/**
 * Read-only validation for a download attempt, kept separate from the route
 * handler so it's testable against the real test database with no
 * Cloudinary/network dependency (matching how no existing test in this repo
 * exercises Cloudinary — see books.test.ts). Deliberately does NOT increment
 * downloadCount or write a DownloadLog row itself — that only happens once
 * the caller has actually fetched and watermarked the file (see
 * recordSuccessfulDownload below). Counting an attempt before the file was
 * actually served would burn one of the buyer's 5 downloads on a Cloudinary
 * hiccup that isn't their fault.
 *
 * The token is the sole lookup key: there is no separate order/item id
 * accepted anywhere in this path, so a token from one order can never
 * resolve another order's file.
 */
export async function resolveDownload(token: string): Promise<ResolveDownloadResult> {
  const row = await db.downloadToken.findUnique({
    where: { token },
    include: { order: true, orderItem: { include: { bookFormat: true } } },
  });
  if (!row) return { ok: false, error: "not_found" };

  const orderInfo = { orderReference: row.order.reference, accessToken: row.order.accessToken };

  if (row.revokedAt) return { ok: false, error: "revoked", ...orderInfo };
  if (row.expiresAt.getTime() <= Date.now()) return { ok: false, error: "expired", ...orderInfo };
  if (row.downloadCount >= row.maxDownloads) {
    return { ok: false, error: "limit_reached", ...orderInfo };
  }

  const ebookAssetUrl = row.orderItem.bookFormat.ebookAssetUrl;
  if (!ebookAssetUrl) {
    // Defensive: a token is only ever issued for an EBOOK item that already
    // has an asset. Treat a missing asset (e.g. removed after the fact) as
    // not_found rather than crash the route.
    return { ok: false, error: "not_found" };
  }

  return {
    ok: true,
    downloadTokenId: row.id,
    maxDownloads: row.maxDownloads,
    ebookAssetUrl,
    filename: `${slugify(row.orderItem.titleSnapshot)}.pdf`,
    watermarkText: buildWatermarkText({
      customerName: row.order.customerName,
      customerEmail: row.order.customerEmail,
      orderReference: row.order.reference,
    }),
    ...orderInfo,
  };
}

/**
 * Called by the route handler only once it has the watermarked bytes ready
 * to serve — the actual "successful download" the task asks to count and
 * log. Guarded conditional update, same concurrency discipline as
 * transitionPayment: two simultaneous downloads on the last remaining slot
 * both pass resolveDownload's pre-check, but only one guarded update here
 * matches. The loser still gets the file it already fetched (refusing after
 * doing all that work over one lost race is worse for a legitimate buyer
 * than the rare extra download) but its attempt isn't logged or counted.
 */
export async function recordSuccessfulDownload(
  downloadTokenId: string,
  maxDownloads: number,
  meta: { ip: string | null; userAgent: string | null },
): Promise<boolean> {
  const updated = await db.downloadToken.updateMany({
    where: { id: downloadTokenId, downloadCount: { lt: maxDownloads } },
    data: { downloadCount: { increment: 1 } },
  });
  if (updated.count === 0) return false;

  await db.downloadLog.create({
    data: { downloadTokenId, ipAddress: meta.ip, userAgent: meta.userAgent },
  });
  return true;
}

// --- buyer self-service regeneration ---------------------------------

export type RegenerateResult =
  | { ok: true; token: string }
  | { ok: false; error: "order_not_found" }
  | { ok: false; error: "item_not_found" };

/**
 * PUBLIC BY DESIGN — no requireAdmin/requireStaff. Validates the accessToken
 * itself, same pattern as submitClaim(). Only ever issues an ADDITIONAL
 * fresh token; an old expired/exhausted one is simply left alone (it's
 * already unusable via its own expiresAt/downloadCount, so there's nothing
 * to revoke).
 */
export async function regenerateDownloadToken(input: {
  orderReference: string;
  accessToken: string;
  orderItemId: string;
}): Promise<RegenerateResult> {
  const order = await getOrderByReference(input.orderReference);
  if (!order || order.accessToken !== input.accessToken) {
    return { ok: false, error: "order_not_found" };
  }

  const item = order.items.find((i) => i.id === input.orderItemId);
  if (!item || item.formatSnapshot !== "EBOOK" || item.fulfilmentState !== "DELIVERED_DIGITAL") {
    return { ok: false, error: "item_not_found" };
  }

  const token = generateDownloadToken();
  await db.$transaction(async (tx) => {
    await tx.downloadToken.create({
      data: {
        token,
        orderId: order.id,
        orderItemId: item.id,
        expiresAt: new Date(Date.now() + TOKEN_EXPIRY_MS),
      },
    });
    await recordOrderEvent(tx, {
      orderId: order.id,
      type: "download.issued",
      actor: { type: "BUYER" },
      metadata: { orderItemId: item.id, regenerated: true },
    });
  });

  return { ok: true, token };
}

// --- status page read ---------------------------------------------------

export type DownloadInfo = {
  token: string;
  usable: boolean;
  expiresAt: Date;
  downloadsRemaining: number;
} | null;

/** The most recent token issued for an order item, and whether it still
 *  works — the status page's "N of 5 downloads used" / "get a new one". */
export async function getDownloadInfoForItem(orderItemId: string): Promise<DownloadInfo> {
  const latest = await db.downloadToken.findFirst({
    where: { orderItemId },
    orderBy: { createdAt: "desc" },
  });
  if (!latest) return null;

  const usable =
    !latest.revokedAt &&
    latest.expiresAt.getTime() > Date.now() &&
    latest.downloadCount < latest.maxDownloads;

  return {
    token: latest.token,
    usable,
    expiresAt: latest.expiresAt,
    downloadsRemaining: Math.max(0, latest.maxDownloads - latest.downloadCount),
  };
}

// --- admin order review read ---------------------------------------------

export type DownloadTokenWithLogs = DownloadToken & {
  logs: { id: string; ipAddress: string | null; userAgent: string | null; createdAt: Date }[];
};

/** Every token issued for an order, newest first, with its download log
 *  rows — for the admin order screen (docs §5.10: visible on order detail). */
export function listDownloadTokensForOrder(orderId: string): Promise<DownloadTokenWithLogs[]> {
  return db.downloadToken.findMany({
    where: { orderId },
    include: { logs: { orderBy: { createdAt: "asc" } } },
    orderBy: { createdAt: "desc" },
  });
}
