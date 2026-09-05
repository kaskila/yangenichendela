import { getSignedEbookUrl } from "@/lib/cloudinary";
import { watermarkPdf } from "@/lib/pdf-watermark";
import { recordSuccessfulDownload, resolveDownload } from "@/lib/services/fulfilment";

// API route (CLAUDE.md architecture: "API routes only for webhooks and
// downloads"). The buyer's browser only ever sees THIS URL — the signed
// Cloudinary URL is fetched server-side and never appears in any response
// sent back to them.
//
// PUBLIC BY DESIGN, no requireAdmin/requireStaff — the token itself is the
// only credential, same pattern as every other buyer-facing magic link in
// this app. It is the sole lookup key: nothing here accepts a separate
// order/item id, so a token from one order can never serve another order's
// file.

function clientIp(request: Request): string | null {
  const fwd = request.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]!.trim();
  return request.headers.get("x-real-ip");
}

function htmlPage(title: string, message: string, statusHref?: string): string {
  const link = statusHref
    ? `<p><a href="${statusHref}">Go to your order</a></p>`
    : `<p><a href="/">Go to the home page</a></p>`;
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>${title}</title></head>
<body style="font-family:system-ui,sans-serif;max-width:32rem;margin:2rem auto;padding:0 1rem;">
  <h1>${title}</h1>
  <p>${message}</p>
  ${link}
</body>
</html>`;
}

function statusHref(orderReference: string, accessToken: string): string {
  return `/orders/${orderReference}?t=${encodeURIComponent(accessToken)}`;
}

function htmlResponse(status: number, body: string): Response {
  return new Response(body, {
    status,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
): Promise<Response> {
  const { token } = await params;
  const resolved = await resolveDownload(token);

  if (!resolved.ok) {
    switch (resolved.error) {
      case "not_found":
        return htmlResponse(
          404,
          htmlPage("Link not found", "This download link isn't valid."),
        );
      case "revoked":
        return htmlResponse(
          410,
          htmlPage(
            "Download revoked",
            "This download link has been revoked.",
            statusHref(resolved.orderReference, resolved.accessToken),
          ),
        );
      case "expired":
        return htmlResponse(
          410,
          htmlPage(
            "Link expired",
            "This download link has expired. You can get a new one from your order page.",
            statusHref(resolved.orderReference, resolved.accessToken),
          ),
        );
      case "limit_reached":
        return htmlResponse(
          403,
          htmlPage(
            "No downloads left",
            "You've used all the downloads on this link. You can get a new one from your order page.",
            statusHref(resolved.orderReference, resolved.accessToken),
          ),
        );
    }
  }

  let watermarked: Uint8Array;
  try {
    const signedUrl = getSignedEbookUrl(resolved.ebookAssetUrl);
    if (!signedUrl) throw new Error("ebook delivery is not configured");
    const fileResponse = await fetch(signedUrl);
    if (!fileResponse.ok) throw new Error(`upstream fetch failed: ${fileResponse.status}`);
    const bytes = new Uint8Array(await fileResponse.arrayBuffer());
    watermarked = await watermarkPdf(bytes, resolved.watermarkText);
  } catch (err) {
    console.error("Failed to prepare an ebook download:", err);
    return htmlResponse(
      500,
      htmlPage(
        "Something went wrong",
        "We couldn't prepare your download just now. Try again in a moment.",
        statusHref(resolved.orderReference, resolved.accessToken),
      ),
    );
  }

  await recordSuccessfulDownload(resolved.downloadTokenId, resolved.maxDownloads, {
    ip: clientIp(request),
    userAgent: request.headers.get("user-agent"),
  });

  return new Response(new Blob([Uint8Array.from(watermarked)]), {
    status: 200,
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename="${resolved.filename}"`,
      "cache-control": "no-store",
    },
  });
}
