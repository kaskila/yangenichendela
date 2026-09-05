import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { buildWatermarkText, watermarkPdf } from "@/lib/pdf-watermark";

async function makeFixture(pageCount: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pageCount; i++) {
    doc.addPage([200, 200]);
  }
  return doc.save();
}

describe("buildWatermarkText", () => {
  it("includes the buyer's name, email and order reference", () => {
    const text = buildWatermarkText({
      customerName: "Chanda Mwansa",
      customerEmail: "chanda@example.test",
      orderReference: "YC-7K3M9",
    });
    expect(text).toContain("Chanda Mwansa");
    expect(text).toContain("chanda@example.test");
    expect(text).toContain("YC-7K3M9");
  });
});

describe("watermarkPdf", () => {
  it("returns a still-valid PDF with the same page count", async () => {
    const fixture = await makeFixture(1);
    const watermarked = await watermarkPdf(fixture, "Licensed to Test Buyer");

    const reloaded = await PDFDocument.load(watermarked);
    expect(reloaded.getPageCount()).toBe(1);
  });

  it("is larger than the original (text was actually drawn)", async () => {
    const fixture = await makeFixture(1);
    const watermarked = await watermarkPdf(fixture, "Licensed to Test Buyer — Order YC-ABCDE");
    expect(watermarked.byteLength).toBeGreaterThan(0);
    // A blank fixture page plus embedded font + drawn text operators is
    // reliably bigger than the blank original.
    expect(watermarked.byteLength).toBeGreaterThan(fixture.byteLength);
  });

  it("stamps every page, not just the first (growth scales with page count)", async () => {
    const one = await makeFixture(1);
    const five = await makeFixture(5);
    const text = "Licensed to Test Buyer — Order YC-ABCDE";

    const oneWatermarked = await watermarkPdf(one, text);
    const fiveWatermarked = await watermarkPdf(five, text);

    const oneGrowth = oneWatermarked.byteLength - one.byteLength;
    const fiveGrowth = fiveWatermarked.byteLength - five.byteLength;

    // If only the first page were stamped, fiveGrowth would stay close to
    // oneGrowth (the font is embedded once either way). Stamping every page
    // instead makes the growth scale with page count.
    expect(fiveGrowth).toBeGreaterThan(oneGrowth * 2);
  });
});
