// Shared by the client book form (live preview as the title is typed) and the
// create action (fallback when the slug field is left blank). Deliberately
// dependency-free and framework-free so both sides can import it.

const MAX_SLUG_LENGTH = 80;
const COMBINING_MARKS = /[̀-ͯ]/g;

/** Lowercase, ASCII, hyphen-separated. "Level Up — Unlock Your Fate" -> "level-up-unlock-your-fate". */
export function slugify(input: string): string {
  return input
    .normalize("NFKD")
    .replace(COMBINING_MARKS, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/-+$/g, ""); // drop a trailing dash the slice may have left
}
