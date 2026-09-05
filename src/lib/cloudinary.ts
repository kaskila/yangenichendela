import "server-only";
import { v2 as cloudinary } from "cloudinary";
import { PDFDocument } from "pdf-lib";

// Cover-image uploads. Public images only — the private receipt-screenshot path
// (signed, admin-only) comes with the payment work and is not this. The API
// secret never leaves the server: uploads happen inside a server action, and
// this module is `server-only`.
//
// If the CLOUDINARY_* vars are unset the admin form degrades to accepting a
// pasted URL rather than crashing (see uploadCoverAction), so callers must check
// isCloudinaryConfigured() first.

const ACCEPTED_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;
const MAX_BYTES = 5 * 1024 * 1024; // 5 MB
// Ebook PDFs: capped well below the 20 MB originally planned. Verified live
// against this Cloudinary account: a raw-resource upload over ~10 MB
// (10,485,760 bytes exactly) is rejected by Cloudinary itself with "File
// size too large" — a plan-level ceiling on raw/video uploads, not a Next.js
// or serverless limit. 9 MB leaves headroom below that observed ceiling. If
// the Cloudinary plan is ever upgraded, this can be revisited — but there is
// no point allowing an admin to select a file the very next step will
// reject.
const MAX_EBOOK_BYTES = 9 * 1024 * 1024; // 9 MB
const PDF_MAGIC = Buffer.from("%PDF-", "utf8");

export function isCloudinaryConfigured(): boolean {
  return Boolean(
    process.env.CLOUDINARY_CLOUD_NAME &&
      process.env.CLOUDINARY_API_KEY &&
      process.env.CLOUDINARY_API_SECRET,
  );
}

let configured = false;
function ensureConfigured(): void {
  if (configured) return;
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
    secure: true,
  });
  configured = true;
}

export type CoverUploadResult =
  | { ok: true; url: string }
  | { ok: false; error: string };

/** Validate then upload a cover image. Never throws to the caller. */
export async function uploadCoverImage(file: File): Promise<CoverUploadResult> {
  if (!isCloudinaryConfigured()) {
    return { ok: false, error: "Image uploads are not configured." };
  }
  if (file.size === 0) {
    return { ok: false, error: "Choose an image file to upload." };
  }
  if (!ACCEPTED_TYPES.includes(file.type as (typeof ACCEPTED_TYPES)[number])) {
    return { ok: false, error: "Upload a PNG, JPEG or WebP image." };
  }
  if (file.size > MAX_BYTES) {
    return { ok: false, error: "That image is over 5 MB. Use a smaller file." };
  }

  ensureConfigured();

  try {
    const bytes = Buffer.from(await file.arrayBuffer());
    const dataUri = `data:${file.type};base64,${bytes.toString("base64")}`;
    const result = await cloudinary.uploader.upload(dataUri, {
      folder: "yangeni/covers",
      resource_type: "image",
      overwrite: true,
    });
    return { ok: true, url: result.secure_url };
  } catch {
    return { ok: false, error: "The upload failed. Try again." };
  }
}

/**
 * A payment-receipt screenshot. UNLIKE a book cover this is private — it shows
 * the buyer's phone number and wallet balance. Uploaded to a separate folder,
 * with `type: "authenticated"` so a raw URL will not deliver the image without a
 * signature, and an unguessable public_id. The stored URL is ADMIN-ONLY: it must
 * never appear in a public page, OG tag or JSON-LD. The admin claim-review slice
 * generates signed delivery URLs from it.
 *
 * A receipt image is NOT verification — it can be edited, or be a genuine
 * receipt for a payment to someone else. The admin amount-entry gate still stands.
 */
export async function uploadReceiptImage(file: File): Promise<CoverUploadResult> {
  if (!isCloudinaryConfigured()) {
    return { ok: false, error: "Image uploads are not configured." };
  }
  if (file.size === 0) {
    return { ok: false, error: "Choose an image file to upload." };
  }
  if (!ACCEPTED_TYPES.includes(file.type as (typeof ACCEPTED_TYPES)[number])) {
    return { ok: false, error: "Upload a PNG, JPEG or WebP image." };
  }
  if (file.size > MAX_BYTES) {
    return { ok: false, error: "That image is over 5 MB. Use a smaller file." };
  }

  ensureConfigured();

  try {
    const bytes = Buffer.from(await file.arrayBuffer());
    const dataUri = `data:${file.type};base64,${bytes.toString("base64")}`;
    const result = await cloudinary.uploader.upload(dataUri, {
      folder: "yangeni/receipts",
      resource_type: "image",
      type: "authenticated",
      public_id: crypto.randomUUID().replace(/-/g, ""),
      overwrite: false,
    });
    return { ok: true, url: result.secure_url };
  } catch {
    return { ok: false, error: "The upload failed. Try again." };
  }
}

/**
 * A private ebook master PDF. Same reasoning as uploadReceiptImage: stored
 * with type: "authenticated" and an unguessable public_id so a raw URL 401s.
 * resource_type is "raw" (not "image") — Cloudinary treats PDFs as raw files,
 * and unlike an image resource, a raw public_id carries its own extension
 * rather than having one auto-appended, hence the ".pdf" baked into it here.
 *
 * The stored URL is ADMIN-ONLY, same as receiptImageUrl: it must never appear
 * in a public page, OG tag, JSON-LD, or the buyer's status page. The buyer
 * only ever sees the /api/downloads/[token] route, never this URL — the
 * fulfilment slice fetches the PDF through a signed delivery URL server-side,
 * watermarks it, and streams the result, so this URL never reaches the buyer.
 *
 * Validated three ways before it ever reaches Cloudinary: MIME type,
 * "%PDF-" magic bytes (a spoofed content-type shouldn't get through), and an
 * actual pdf-lib parse — catching a corrupt upload here, once, rather than on
 * every future download.
 */
export async function uploadEbookFile(file: File): Promise<CoverUploadResult> {
  if (!isCloudinaryConfigured()) {
    return { ok: false, error: "Ebook uploads are not configured." };
  }
  if (file.size === 0) {
    return { ok: false, error: "Choose a PDF file to upload." };
  }
  if (file.type !== "application/pdf") {
    return { ok: false, error: "Upload a PDF file." };
  }
  if (file.size > MAX_EBOOK_BYTES) {
    return { ok: false, error: "That PDF is over 9 MB. Use a smaller file." };
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  if (!bytes.subarray(0, PDF_MAGIC.length).equals(PDF_MAGIC)) {
    return { ok: false, error: "That file doesn't look like a valid PDF." };
  }
  try {
    await PDFDocument.load(bytes);
  } catch {
    return { ok: false, error: "That PDF could not be read. It may be corrupted." };
  }

  ensureConfigured();

  try {
    const dataUri = `data:application/pdf;base64,${bytes.toString("base64")}`;
    const result = await cloudinary.uploader.upload(dataUri, {
      folder: "yangeni/ebooks",
      resource_type: "raw",
      type: "authenticated",
      public_id: `${crypto.randomUUID().replace(/-/g, "")}.pdf`,
      overwrite: false,
    });
    return { ok: true, url: result.secure_url };
  } catch {
    return { ok: false, error: "The upload failed. Try again." };
  }
}

// Matches the secure_url an "authenticated" upload returns, e.g.
// https://res.cloudinary.com/<cloud>/image/authenticated/s--XXXXXXXX--/v1234/yangeni/receipts/<id>.jpg
// (or .../raw/authenticated/... for ebook PDFs). Cloudinary bakes an
// upload-time signature segment (`s--...--`) into that URL even though it
// 401s if requested as-is — confirmed live against a real upload; an earlier
// version of this regex didn't account for that segment at all, which
// corrupted the parsed public_id. This re-derives the
// public_id/version/format from the stored URL rather than adding columns
// for them, shared by both the image (receipt) and raw (ebook) cases below.
function authenticatedUrlPattern(resourceType: "image" | "raw"): RegExp {
  return new RegExp(
    `^https://res\\.cloudinary\\.com/[^/]+/${resourceType}/authenticated/(?:s--[^/]+--/)?(?:(v\\d+)/)?(.+)$`,
  );
}

function parseAuthenticatedUrl(
  rawUrl: string,
  resourceType: "image" | "raw",
): { publicId: string; format?: string; version?: string } | null {
  const match = authenticatedUrlPattern(resourceType).exec(rawUrl);
  if (!match) return null;
  const [, versionSegment, publicIdWithExt] = match;

  const dot = publicIdWithExt.lastIndexOf(".");
  const publicId = dot === -1 ? publicIdWithExt : publicIdWithExt.slice(0, dot);
  const format = dot === -1 ? undefined : publicIdWithExt.slice(dot + 1);
  const version = versionSegment ? versionSegment.slice(1) : undefined;

  return { publicId, format, version };
}

/**
 * Regenerate a signed delivery URL for a receipt uploaded by
 * uploadReceiptImage(). Returns null when Cloudinary isn't configured or the
 * stored URL isn't a Cloudinary authenticated-delivery URL (e.g. a
 * degraded-mode pasted URL, or no receipt at all) — callers show a fallback
 * in that case. ADMIN-ONLY: the URL this returns must never appear outside
 * the admin claim-review screen.
 */
export function getSignedReceiptUrl(rawUrl: string): string | null {
  if (!isCloudinaryConfigured()) return null;

  const parsed = parseAuthenticatedUrl(rawUrl, "image");
  if (!parsed) return null;

  ensureConfigured();

  return cloudinary.url(parsed.publicId, {
    type: "authenticated",
    resource_type: "image",
    sign_url: true,
    secure: true,
    ...(parsed.format ? { format: parsed.format } : {}),
    ...(parsed.version ? { version: parsed.version } : {}),
  });
}

/**
 * Regenerate a signed delivery URL for an ebook PDF uploaded by
 * uploadEbookFile(). Used server-side only, to fetch the bytes for
 * watermarking. Never returned to a buyer; see uploadEbookFile's doc comment.
 *
 * UNLIKE getSignedReceiptUrl, this does NOT use `cloudinary.url({ sign_url:
 * true })` — verified live against this Cloudinary account that the simple
 * CDN-signed-URL approach 401s for `resource_type: "raw"` even with a
 * correctly reconstructed public_id (it works fine for images). Raw
 * authenticated resources need the Admin-API-backed download endpoint
 * instead, via `cloudinary.utils.private_download_url()`. That call also
 * wants the public_id WITH its extension included and no separate `format` —
 * passing them separately (as image delivery does) 404s.
 */
export function getSignedEbookUrl(rawUrl: string): string | null {
  if (!isCloudinaryConfigured()) return null;

  const parsed = parseAuthenticatedUrl(rawUrl, "raw");
  if (!parsed) return null;

  ensureConfigured();

  const publicId = parsed.format ? `${parsed.publicId}.${parsed.format}` : parsed.publicId;

  return cloudinary.utils.private_download_url(publicId, "", {
    resource_type: "raw",
    type: "authenticated",
    attachment: true,
  });
}
