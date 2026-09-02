# CLAUDE.md

Project constitution. Read fully before any task. Where this conflicts with a
general best practice, this wins.

When a requirement is ambiguous, do not invent a business rule. Either raise it,
or make the smallest safe assumption and document it in the commit message.
Batch questions — gather them and report together, do not ask serially.

**No safe assumption exists for four things.** Payments, authorization, event
capacity, or any factual claim about the client — stop and ask. A wrong guess
there costs money, leaks data, oversells a public event, or misrepresents a real
person.

Reference docs, read when the task touches them:
`docs/client-facts.md` (every client fact) · `docs/manual-mobile-money-flow.md`
(payment states, admin screens, fraud cases) · `docs/brand.md` (palette,
typography, copy style, performance and accessibility detail).

Last updated: 2026-09-02

---

## What this is

Author, speaking and advisory platform for **Yangeni Chendela** — fifteen years
in HR across seven organisations, currently HR Director at Lubona Meat Products
and Director of **WANGA HR Consultancy** since 2014. Author of *Become
Unstoppable* and *Level Up*.

**"Yangeni Chendela" is the confirmed site name** — page titles, nav logotype,
OG tags, schema.org, all prose. Note `Book.authorCredit` is a separate field
recording what is printed on each cover; the *Level Up* cover prints CHENDELA
YANGENI. Do not normalise cover credits to the site name.

Three jobs, in priority order:

1. **Sell books** — ebook and paperback, paid by Zambian mobile money.
2. **Credibility** — convince an HR director or event organiser in ten seconds.
3. **Grow the list** — newsletter and enquiry capture feeding advisory work.

Books are the visible brief; advisory leads are where the money is. When a
decision trades one against the other, favour credibility.

**Events are dormant.** The *Level Up* launch has already happened. The
registration service and its capacity logic are built and tested (see "Events"
below) but serve nothing. Do not prioritise event work, do not build an event
page, and do not delete the service — it will be used for the next event.

## Audience

| Who | Context |
|---|---|
| Lusaka book buyer | Mid-range Android, expensive data, **Facebook in-app browser** |
| HR director / organiser | Desktop from LinkedIn, scanning for ~8 seconds |
| Diaspora buyer | Card payment, phase two |
| **Yangeni (admin)** | **Phone, one-handed, while reading his SMS inbox** |

The last row gets forgotten. The admin is a mobile tool, not a desktop one.

**Consequence: content must render without JavaScript.** Never gate visible
content behind scroll-triggered JS. If JS fails in the in-app browser, the page
must still read, and forms must still submit.

---

## Scope

Build what is listed. An unrequested feature is unreviewed code carrying
maintenance cost.

**Admin** — auth ✅ · books CRUD · payment queue · claim review · unmatched
payments · fulfilment queue · order timeline · flags.

**Commerce** — catalogue · book detail · cart · checkout · payment instructions
· claim submission · order status · ebook delivery · print fulfilment.

**Public** — home · about · books · speaking · advisory · contact · newsletter.

**Out of scope for v1** — card gateway integration (interface exists, adapter
comes after KYC) · international shipping · courier APIs · stock sync · returns
· QR check-in · multi-currency · blog CMS · customer accounts beyond magic-link
order access · discount codes · analytics dashboards · rich text editing ·
image cropping · drag-and-drop reordering · bulk actions.

If something out of scope seems necessary, raise it rather than building it.

---

## Repository status

**Built and committed:** Next.js 16.3.4 · React 19.2.8 · TS 5.9 strict ·
Tailwind v4 · ESLint 9 · Prisma 7.10, full schema migrated · Better Auth 1.7
with `requireAdmin`/`requireStaff`, `/admin/login`, sign-out · zod 4.5.4 ·
Vitest with a real test database · `src/lib/services/registration.ts` and its
15 integration tests.

**Not built:** books CRUD, all public pages, `transitionPayment()`, all payment
work, email, Cloudinary, Playwright.

**Do not touch** `src/app/page.tsx` and `layout.tsx` — still create-next-app
defaults awaiting brand assets.

### Versions post-date model training data — read node_modules, do not recall

- **Prisma 7.10 removed connection URLs from `schema.prisma`.** Datasource is
  `provider` only. A driver adapter is mandatory: `src/lib/db.ts` builds
  `PrismaPg` from `DATABASE_URL`; `prisma.config.ts` holds the migration URL and
  calls `process.loadEnvFile()`.
- **Import from `@/generated/prisma/client`.** Never `@prisma/client`, and there
  is no bare `@/generated/prisma` index.
- **Better Auth 1.7 scopes account identity by `issuer`.** For credentials the
  value is `"local:credential"` (from `createLocalAccountIssuer`), not
  `"credential"`. `role` reaches the session only because it is declared in
  `user.additionalFields` — remove that and every guard 403s everyone.
- **`forbidden()` requires `experimental.authInterrupts: true`** in
  `next.config.ts`. It is experimental: if a Next update changes it, the
  authorization *denial* path breaks. Check it after any Next upgrade.
- `next lint` is removed. Bare `tsc` fails on a clean tree — Next 16 generates
  `LayoutProps`/`PageProps` into `.next/types`, hence `next typegen && tsc`.

**Accepted, do not "fix":** `npm audit` reports 4 highs inside Prisma's own
subtree (`deepmerge-ts`; `mysql2`, unreachable here). `audit fix --force`
downgrades to Prisma 6. Prisma 8 is an rc — do not upgrade.

---

## Commands

```
npm run dev · build · lint (eslint --max-warnings 0) · typecheck · test
npm run db:migrate · db:studio · db:migrate:test
npm run db:seed:admin -- <email> <password> <name> <ADMIN|STAFF>
```

`postinstall` runs `prisma generate`. **npm, not pnpm** — do not migrate
lockfiles.

**Definition of done:** typecheck, lint and test pass; the feature works end to
end in a browser; it is committed. Not before all four.

**Every schema change goes through a migration file** — never a direct `psql`
`ALTER`. Direct edits are invisible to version control and to production.

## Testing

Vitest for services. Playwright for checkout only, when it exists. Tests hit a
**real** test database — a mocked Prisma client lets a read-then-write
implementation pass, which is the one thing they exist to catch. A vitest
`globalSetup` runs `prisma migrate deploy` against `.env.test`;
`fileParallelism` is false because there is one database.

The tests that matter more than the rest combined:

1. Every payment state transition, including illegal ones that must throw.
2. Duplicate transaction ID rejection, and double-confirmation of a claim.
3. Money conversion edge cases — see Rule 2.
4. (Built) 250 concurrent registrations against a 200-seat event.

## Environment

```
DATABASE_URL  DIRECT_URL  BETTER_AUTH_SECRET  BETTER_AUTH_URL
NEXT_PUBLIC_APP_URL  CLOUDINARY_*  RESEND_API_KEY|BREVO_API_KEY  EMAIL_FROM
```

Keep `.env.example` in sync. Never commit `.env`.

**`BETTER_AUTH_SECRET` must be set in production.** Without it Better Auth falls
back to a hardcoded default and every session token is forgeable. The build only
warns.

**Databases:** local PostgreSQL 17.5 (`yangeni`, `yangeni_test`) in dev; Neon in
production. Locally `DATABASE_URL` and `DIRECT_URL` are identical direct
connections; on Neon they differ (pooled vs direct). Interactive transactions
behave differently through a pooler — run the concurrency test against a Neon
branch before going live.

---

## Absolute rules

**1. Never invent facts about the client.** Every factual claim must come from
`docs/client-facts.md`. If it is not there, stop and ask. No fabricated
statistics, testimonials, review counts, subscriber numbers, press logos or
endorsements — he is a real, identifiable professional in a small market.
Missing content means omitting the section or using a **visibly** fake
placeholder, never plausible fiction.

**2. Money is integer minor units.** `priceMinor: Int`, ngwee not kwacha. Never
float, Decimal or string. Currency always an explicit adjacent field.

Conversion lives in `src/lib/money.ts` with tests, and nowhere else. Parse as a
**string** — split on the decimal point, validate the fraction to 2 digits,
combine as an integer. **Never `parseFloat(x) * 100`**: in IEEE 754,
`250.10 * 100` is `25009.999999999996`, which truncates to a price one ngwee
short, silently. Format back to "K250.50" only at render.

**3. Payment state changes go through `transitionPayment()`.** No route, action,
script or seed writes `paymentState` directly.

```
PENDING   → SUBMITTED | EXPIRED | CANCELLED
SUBMITTED → CONFIRMED | REJECTED | UNDERPAID | EXPIRED
REJECTED  → SUBMITTED        UNDERPAID → CONFIRMED | REFUNDED
CONFIRMED → REFUNDED         EXPIRED   → SUBMITTED
```

**4. Side effects come after the guarded state change.** Conditional
`updateMany` with the expected current state in the `where`; if `count === 0`,
throw — someone else got there first. Only then issue tokens, send email, write
events. Sends carry an idempotency key of `${orderId}:${eventType}` on
`Notification`.

**5. Every server action starts with `requireAdmin()` or `requireStaff()`.**
Middleware is not a substitute. An unprotected server action is a public
endpoint regardless of what the UI shows. Public actions (e.g. checkout) are
deliberate — mark them with a comment so nobody "fixes" them.

**6. Every order mutation writes an `OrderEvent`.** Append-only, never updated
or deleted. It is the only defence in a flow where confirmation is human
judgement.

**7. `OrderItem` snapshots `unitPriceMinor` and `titleSnapshot`** at purchase
time. Raising prices must not change historical orders.

**8. No hard deletes on anything sold.** `OrderItem → BookFormat` is
`onDelete: Restrict` so a sold format cannot vanish from order history. Use
`Book.published` and `BookFormat.isAvailable` as soft toggles. A delete button
works fine in testing and throws a foreign key error the first time it matters.

**9. No secrets in the repo.** No API keys, no merchant numbers, no seed
passwords in committed files.

---

## Architecture

```
server action  →  auth, Zod validation, response shaping
  service      →  business rules, state transitions, side effects
    prisma     →  data access
```

Three layers, no fourth.

- Server Components by default. **Never mark a whole page `"use client"`
  because one part is interactive — extract that part into a leaf.** A
  `"use client"` at page level pulls the entire subtree into the bundle.
- Forms use `<form action={serverAction}>` so they submit without JavaScript.
  `useActionState` returns errors without losing what the user typed.
- Mutations are server actions with Zod schemas. API routes only for webhooks
  and downloads. `revalidatePath` after writes, no client-side refetching.
- Route groups: `(marketing)` · `(shop)` · `(admin)` · `(auth)`. Route groups
  do not affect the URL.
- **Dependencies:** justify need, whether existing tools suffice, maintenance,
  version compatibility, and shipped bundle cost — before adding. Popularity is
  not a reason. Already ruled out: state management, React Query/SWR, animation
  libraries, component kits, ORM wrappers.

**Payment providers.** All payment work goes through the `PaymentProvider`
interface. Manual mobile money is the launch implementation and stays as a
permanent fallback; a gateway becomes a second implementation with **no
fulfilment logic changes**. Fulfilment logic never lives in an admin
controller — the admin confirm action emits the same internal `PaymentEvent` a
webhook would, into the same handler.

---

## Admin

A **tool, not a brochure**. Neutral greys, high contrast, dense spacing, no
decorative type, a thin green header bar as the only brand tie-in. Under 50KB
JS per page.

**Mobile-first for real.** Test at 380px. Claim review fits one phone viewport
with no scroll. Amount input uses `inputmode="numeric"`. The primary action sits
in a bottom bar within thumb reach, not at the top of a form.

**The Confirm button on a payment claim stays disabled until the admin types the
amount they can see in the mobile money account.** This is the only working
control against fabricated transaction references. Do not add a one-click
confirm. Do not "improve" this.

Guards redirect to `/admin/login` when not signed in; signed-in-but-wrong-role
gets a **403**, not a redirect, or a STAFF user loops.

**Copy:** sentence case, active voice, plain verbs. Buttons say what happens
("Confirm payment", not "Submit") and keep the same name through the flow.
Errors state what went wrong and what to do. Rejection reasons are shown
verbatim to buyers, so the fixed list must be customer-safe.

---

## Events (dormant — built, not scheduled)

`src/lib/services/registration.ts` is complete and tested. Read it before
touching anything event-related; do not reimplement.

The seat claim is a guarded conditional decrement — **never** read
`seatsRemaining` and then decide, and never count `Registration` rows. A
database `CHECK ("seatsRemaining" >= 0)` is the backstop.

`RegistrationStatus` is `CONFIRMED | WAITLIST | CANCELLED` — **`WAITLIST`, not
`WAITLISTED`**. Open/close is the boolean `LaunchEvent.registrationOpen`.

Deliberate behaviours that must survive any refactor: cancellation **either**
promotes the waitlist head **or** increments `seatsRemaining`, never both; a
repeat submission returns the existing row rather than throwing; a `CANCELLED`
row is revived on re-registration. When check-in is eventually built it is a
searchable list with a big button per row — no QR — and a second check-in is a
**neutral** already-checked-in state, not an error.

---

## Working method

Vertical slices, not layers. Commit at every green state. Plan mode for
payments, auth, or money conversion. Schema changes are a conversation, not a
unilateral edit. Do not refactor code you were not asked to touch.

## Build order

1. Auth seam ✅
2. Registration service ✅ (dormant)
3. Admin shell + books CRUD ← **current**
4. Public book catalogue and detail pages
5. `transitionPayment()` + tests
6. Cart, checkout, order creation, payment instructions
7. Claim submission + normalisation + rate limits
8. Admin payment queue + claim review
9. Download tokens + watermarking + order status page
10. Transactional email
11. Marketing pages — home, about, speaking, advisory
12. Print fulfilment queue, unmatched payments, flags

Marketing pages sit late because they are the most blocked on client assets,
not because they matter least.

---

## Open items — do not invent answers

**Blocking commerce (items 6–8):** book prices per format in kwacha · merchant
mobile money numbers per network, and whether those lines are personal or
registered to a business · delivery flat rates (Lusaka / rest of Zambia) ·
**real transaction ID formats from actual Airtel, MTN and Zamtel receipts —
write no validation regex until confirmed** · refund policy for digital goods ·
Resend vs Brevo.

**Blocking design (item 11):** brand hex values and logo SVG · flat cover
artwork for both books (the 3D mockup is hero material only) · the rest of the
*Level Up* photo shoot · whether the board-chair-then-HR-Director sequence at
Lubona is a story he wants told.

**Blocking the advisory page:** is WANGA HR Consultancy actively trading? His
About text says he wants to *become* a consultant; he has been its Director
since 2014. Decides whether advisory is an established firm with its own
identity or a new offering under his personal brand.

**Open, non-blocking:** should delegate/customer organisation be captured? It
would need a schema column. Worth asking — a room of HR managers is a lead list.