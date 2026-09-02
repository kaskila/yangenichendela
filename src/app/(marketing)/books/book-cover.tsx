import { cloudinaryTransform } from "@/lib/cloudinary-url";

// Server component. One cover renderer for the catalogue and the detail page so
// the "no cover yet" state is identical in both places: a visible, honest
// placeholder — never a broken <img>, never stock photography.

const CLOUDINARY_HOST = "https://res.cloudinary.com";

type Props = {
  url: string | null;
  title: string;
  width: number;
  height: number;
  /** Above-the-fold cover (detail hero) loads eagerly and at high priority. */
  eager?: boolean;
  className?: string;
};

export function BookCover({ url, title, width, height, eager, className }: Props) {
  const box = `border border-border bg-surface-raised${className ? ` ${className}` : ""}`;

  if (!url) {
    return (
      <div
        style={{ width, height }}
        className={`flex items-center justify-center px-2 text-center text-xs text-ink-muted ${box}`}
      >
        Cover image coming soon
      </div>
    );
  }

  // Ask Cloudinary for a display-sized image (1.5× for sharpness on mobile
  // DPRs), auto quality and format. A non-Cloudinary URL is served untouched.
  const src = cloudinaryTransform(
    url,
    `c_fill,w_${Math.round(width * 1.5)},h_${Math.round(height * 1.5)},q_auto:good,f_auto`,
  );
  const fromCloudinary = src.startsWith(CLOUDINARY_HOST);

  return (
    <>
      {/* Warm the connection to the image CDN before the hero LCP request. */}
      {eager && fromCloudinary ? (
        <link rel="preconnect" href={CLOUDINARY_HOST} crossOrigin="anonymous" />
      ) : null}
      {/* eslint-disable-next-line @next/next/no-img-element -- covers come from Cloudinary or an arbitrary pasted URL; next/image would need per-host config */}
      <img
        src={src}
        alt={`Cover of ${title}`}
        width={width}
        height={height}
        loading={eager ? "eager" : "lazy"}
        fetchPriority={eager ? "high" : "auto"}
        decoding="async"
        className={`object-cover ${box}`}
      />
    </>
  );
}
