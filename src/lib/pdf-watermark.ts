import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

// The actual deterrent against ebook link sharing (docs §5.10) — token
// expiry and download caps are hygiene, but a token can still be used once
// before it dies. The watermark makes the SHARER'S OWN identity travel with
// the file, which is what discourages sharing at all. Deliberately not real
// DRM: no encryption, no viewer lock-in — that fails, costs weeks, and
// punishes legitimate buyers (CLAUDE.md).
//
// Pure function, no I/O: takes bytes, returns watermarked bytes. Kept out of
// the download route so it's testable with an in-memory fixture PDF and no
// network/Cloudinary dependency.

const FONT_SIZE = 8;
const MARGIN = 24; // points from the page edge
const TEXT_COLOR = rgb(0.45, 0.45, 0.45);
const TEXT_OPACITY = 0.85;

/**
 * Stamp `footerText` into the bottom-left corner of every page. Position and
 * size are computed per-page from that page's own dimensions — never a fixed
 * Letter/A4 assumption, since a book PDF's page size isn't guaranteed.
 */
export async function watermarkPdf(
  bytes: Uint8Array,
  footerText: string,
): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.load(bytes);
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);

  for (const page of pdfDoc.getPages()) {
    const { width } = page.getSize();
    const textWidth = font.widthOfTextAtSize(footerText, FONT_SIZE);
    page.drawText(footerText, {
      x: Math.min(MARGIN, Math.max(0, (width - textWidth) / 2)),
      y: MARGIN / 2,
      size: FONT_SIZE,
      font,
      color: TEXT_COLOR,
      opacity: TEXT_OPACITY,
    });
  }

  return pdfDoc.save();
}

/** The buyer's identity travels with the file — this is the whole point. */
export function buildWatermarkText(params: {
  customerName: string;
  customerEmail: string;
  orderReference: string;
}): string {
  return `Licensed to ${params.customerName} (${params.customerEmail}) — Order ${params.orderReference} — do not distribute`;
}
