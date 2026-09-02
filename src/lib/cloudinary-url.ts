// Pure URL rewriting for Cloudinary *delivery* URLs — no SDK, safe to import on
// the server or the client. A non-Cloudinary URL (e.g. one pasted into the
// admin's degraded mode) passes through untouched.

const DELIVERY_URL =
  /^(https:\/\/res\.cloudinary\.com\/[^/]+\/image\/upload\/)((?:v\d+\/)?)(.+)$/;

/** Insert a transformation segment, e.g. "c_fill,w_1200,h_630,q_auto,f_auto". */
export function cloudinaryTransform(url: string, params: string): string {
  const m = DELIVERY_URL.exec(url);
  return m ? `${m[1]}${params}/${m[2]}${m[3]}` : url;
}
