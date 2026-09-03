import "server-only";
import { v2 as cloudinary } from "cloudinary";

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
