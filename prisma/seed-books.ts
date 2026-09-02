/**
 * Seed the two books for local development.
 *
 *   npx tsx prisma/seed-books.ts
 *   npm run db:seed:books
 *
 * Goes through the real createBook() service (money parsing, slug rules, P2002)
 * rather than raw inserts. Re-runnable: a book whose slug already exists is left
 * untouched.
 *
 * SOURCED FROM docs/client-facts.md:
 *   - "Level Up" title / subtitle "and unlock your Fate" / category line
 *     "Inspiration & Leadership" / cover credit "CHENDELA YANGENI"
 *   - "Become Unstoppable" title + subtitle (the full title on file)
 *
 * NOT KNOWN — obviously-fake placeholders so nobody ships them as real content:
 *   - every description  -> "[description pending]"
 *   - every price        -> 0
 *   - Become Unstoppable's cover credit -> "[author credit pending]"
 *     (client-facts.md only confirms the credit for the Level Up cover, and
 *      CLAUDE.md says do not default authorCredit from anywhere)
 *   - Become Unstoppable's category line -> none (nullable; not on file)
 */
import "./load-env";
import { createBook, type BookDraft } from "@/lib/services/books";
import { db } from "@/lib/db";

const PLACEHOLDER_DESCRIPTION = "[description pending]";

const BOOKS: BookDraft[] = [
  {
    title: "Level Up",
    subtitle: "and unlock your Fate",
    categoryLine: "Inspiration & Leadership",
    authorCredit: "CHENDELA YANGENI",
    description: PLACEHOLDER_DESCRIPTION,
    slug: "level-up",
    sortOrder: "1",
    published: true,
    print: { available: true, price: "0", stockOnHand: "" },
    ebook: { available: true, price: "0", stockOnHand: "" },
  },
  {
    title: "Become Unstoppable",
    subtitle: "Fifty Magic Lessons to Maximizing Your Hidden Potential",
    categoryLine: "",
    authorCredit: "[author credit pending]",
    description: PLACEHOLDER_DESCRIPTION,
    slug: "become-unstoppable",
    sortOrder: "2",
    published: true,
    print: { available: true, price: "0", stockOnHand: "" },
    ebook: { available: true, price: "0", stockOnHand: "" },
  },
];

async function main() {
  for (const draft of BOOKS) {
    const existing = await db.book.findUnique({ where: { slug: draft.slug } });
    if (existing) {
      console.log(`  ${draft.slug}: already exists (${existing.id}) — skipped`);
      continue;
    }
    const result = await createBook(draft);
    if (result.ok) {
      console.log(`  ${draft.slug}: created (${result.id})`);
    } else {
      console.error(`  ${draft.slug}: FAILED — ${JSON.stringify(result)}`);
      process.exitCode = 1;
    }
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
