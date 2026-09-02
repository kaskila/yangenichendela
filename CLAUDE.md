# CLAUDE.md

Project constitution. Read fully before any task. These are not suggestions —
where this file conflicts with a general best practice, this file wins.

When a requirement is ambiguous, do not invent a business rule. Either raise
the ambiguity, or make the smallest safe assumption and document it in the
commit message and in code comments.

**The smallest-safe-assumption escape hatch does not apply to four areas.**
For payments, authorization, the registration capacity cap, or any factual
claim about the client, stop and ask. There is no safe assumption in those
four; a wrong guess costs money, leaks data, oversells a public event, or
misrepresents a real person.

Last updated: 2026-09-01

---

## What this is

Author, speaking and advisory platform for **Yangeni Chendela**, a Zambian HR
practitioner with fifteen years across seven organisations. Currently Human
Resources Director at Lubona Meat Products Ltd, and Director of his own firm,
**WANGA HR Consultancy**, since 2014. Author of *Become Unstoppable* and
*Level Up*.

The site does four jobs, in priority order:

1. **Launch registration** — capped-capacity registration and door check-in for
   the *Level Up* book launch. Date-critical. See "Launch" below.
2. **Credibility** — convince an HR director or event organiser in under ten
   seconds that he is worth booking.
3. **Sell books** — ebook and paperback, paid by Zambian mobile money.
4. **Grow the list** — newsletter and enquiry capture feeding advisory work.

Selling books is the visible brief. Advisory leads are where the money is.
When a design or copy decision trades one against the other, favour credibility.

---

## Audience — design decisions follow from this

| Who | Device | Context |
|---|---|---|
| Lusaka book buyer | Mid-range Android, expensive data | Arrives from a Facebook link, inside the **Facebook in-app browser** |
| Diaspora buyer | Better device, card payment | Phase two |
| HR director / event organiser | Desktop, from LinkedIn | Scanning for credibility, ~8 seconds |
| Delegate at the launch | Phone, venue wifi (assume bad) | Needs their registration code |
| **Yangeni (admin)** | **Phone, one-handed** | Confirming payments while reading his SMS inbox |

The last row is the one that gets forgotten. The admin is a mobile tool.

**Consequence:** content must render without JavaScript. No reveal-on-scroll
gating visible content. If JS fails in the in-app browser, the visitor still
sees the page.

---

## Scope

Build what is listed. Do not build what is not, even if it seems obviously
useful — an unrequested feature is unreviewed code carrying maintenance cost
into a launch with a fixed date.

**Launch (critical path)**
Public event page · registration with capacity cap · waitlist · confirmation
email · delegate ticket with code · admin registration list · check-in ·
CSV export.

**Public**
Home · about · books · book detail · speaking · advisory · contact ·
newsletter capture.

**Commerce**
Catalogue · cart · checkout · order creation · payment instructions ·
payment claim submission · order status page · ebook delivery · print
fulfilment tracking.

**Admin**
Auth · payment queue · claim review · unmatched payments · fulfilment queue ·
order timeline · registration management · operational flags.

**Explicitly out of scope for v1**
Card payments and gateway integration (the interface exists; the adapter comes
after KYC clears) · international shipping · courier API integration ·
real-time stock sync · returns handling · QR check-in · multi-currency
display · blog CMS · customer accounts beyond magic-link order access ·
discount codes · analytics dashboards beyond the queue counts.

If something in the out-of-scope list appears necessary, raise it rather than
building it.

---

## Stack

- Next.js (App Router) + TypeScript, strict
- Tailwind CSS v4
- Prisma 7 with `prisma.config.ts` (not the old `generator` block conventions)
- PostgreSQL on Neon
- Better Auth
- Cloudinary — images and private receipt uploads
- Resend or Brevo for transactional email (**decision pending** — Brevo if the
  newsletter consolidates there)
- Vercel

Use the versions actually installed. Do not upgrade a major dependency without
approval.

### Before adding any dependency

Answer all five in the commit message or the PR description. If any answer is
weak, do not add it.

1. Is the functionality actually required by the current task?
2. Can it be done with what is already installed, in a comparable amount of code?
3. Is the package maintained, and what is its transitive dependency weight?
4. Does it work with the installed Next.js and React versions?
5. What does it cost the performance budget? Check the shipped bundle size,
   not the npm listing.

Popularity is not a reason. Familiarity is not a reason.

**Already ruled out, do not reopen without asking:** a state management
library, React Query or SWR, an animation library, a component kit, an ORM
wrapper on top of Prisma.

---

## Repository status

**This is a greenfield create-next-app scaffold.** Nothing in the Architecture,
Launch, Admin or Absolute Rules sections is implemented yet. Those sections are
**specifications to build against**, not descriptions of existing code. If this
file describes a file or function, check whether it exists before relying on it.

Installed and working: Next.js 16.3.4, React 19.2.8, TypeScript 5.9 strict,
Tailwind v4 (CSS-first, default theme), ESLint 9 flat config.

Not yet installed: Prisma, Better Auth, Cloudinary, email provider, Vitest,
Playwright.

**Next.js 16 post-dates the training data of any model working on this repo.**
`node_modules/next/dist/docs/` is the source of truth for App Router APIs, not
recall. Check it before using a Next-specific API. Note `next lint` was removed
in this major.

---

## Commands

```
npm run dev          # local dev (Turbopack is the Next 16 default)
npm run build        # production build — must pass before any commit to main
npm run lint         # eslint --max-warnings 0
npm run typecheck    # tsc --noEmit, zero errors
npm test             # vitest run
npm run db:migrate   # prisma migrate dev
npm run db:studio    # prisma studio
```

**npm, not pnpm.** The repo has `package-lock.json` and no `packageManager`
field. Do not migrate lockfiles mid-project.

Scripts marked above that do not yet exist must be added as part of foundation
work.

**Definition of done for a slice:** typecheck, lint and test pass; the feature
works end to end in a browser; it is committed. Not before all four.

## Testing

Vitest for services and transitions. Playwright for the registration and
checkout flows only — do not add end-to-end coverage elsewhere.

Three tests matter more than the rest of the suite combined:

1. Every payment state transition, including illegal ones that must throw.
2. A concurrency test firing 250 simultaneous registrations at a 200-seat
   event, asserting exactly 200 confirmed and 50 waitlisted.
3. Duplicate transaction ID rejection, and double-confirmation of a claim.

## Environment

```
DATABASE_URL  DIRECT_URL
BETTER_AUTH_SECRET  BETTER_AUTH_URL  NEXT_PUBLIC_APP_URL
CLOUDINARY_CLOUD_NAME  CLOUDINARY_API_KEY  CLOUDINARY_API_SECRET
RESEND_API_KEY (or BREVO_API_KEY)  EMAIL_FROM
```

Keep `.env.example` in sync with every variable the code reads. Never commit
`.env`.

---

## Brand

Owned by the client, taken from the *Level Up* cover and launch material. Do
not invent alternatives.

- **Deep forest green** — primary ground
- **Bright lemon-gold** — accent, display type, primary actions
- Cream and white for text on green
- Heavy, tight-set sans for display; a script for a single accent phrase only;
  tracked caps for category and author lines
- Script logotype "Yangeni" with tracked caps "CHENDELA" beneath
- Circular photo crops with a gold ring

Provisional tokens — **eyedrop from the source files and replace before
launch**, these are read off a JPEG:

```css
--green-deep: #0E3520;   /* ground */
--green-mid:  #164A2E;   /* raised surfaces, hover */
--gold:       #F2CB1D;   /* ON GREEN AND LARGE DISPLAY ONLY */
--gold-text:  #7A6209;   /* darkened — required for gold text on light */
--cream:      #F4F1E8;
```

**Gold fails AA on white at roughly 1.5:1.** This is measured, not predicted.
Gold is a background and large-display colour on green. Any gold-coloured text
on a light surface must use `--gold-text`. Do not nudge the bright gold and
hope; it is not close.

### Tone

The *Level Up* cover reads "Inspiration & Leadership" over warm, stylish
photography — cream suit, straw hat, sunlit garden. The site should carry that
warmth. Do not design austere or corporate-severe; that underserves the reader
who actually buys the book, and the cover is the client's own statement of
tone.

The admin does **not** use brand colours. See "Admin" below.

---

## Absolute rules

These cause real damage if broken. Do not work around them.

### 1. Never invent facts about the client

**Every factual claim about Yangeni must come from `docs/client-facts.md`.
If a fact is not in that file, stop and ask.** Do not infer, round up, or fill
a gap with something plausible.

No fabricated statistics, testimonials, review counts, subscriber numbers,
press logos, or named endorsements. He is a real, identifiable professional in
a small market. A made-up "150 keynotes" or a fake Harvard Business Review logo
is a reputational liability for him and for us.

If real content is missing, either omit the section or use a placeholder that
is **visibly** a placeholder. Never plausible-looking fiction.

### 2. Money is integer minor units

`totalMinor: Int`. Ngwee, not kwacha. Never a float, never a Decimal, never a
string. Currency is always an explicit adjacent field. Format only at the
render boundary.

### 3. Payment state changes go through `transitionPayment()`

No route handler, server action, script or seed writes `paymentState`
directly. That function owns the legal-transition table and throws on anything
illegal.

```
PENDING     → SUBMITTED | EXPIRED | CANCELLED
SUBMITTED   → CONFIRMED | REJECTED | UNDERPAID | EXPIRED
REJECTED    → SUBMITTED
UNDERPAID   → CONFIRMED | REFUNDED
CONFIRMED   → REFUNDED
EXPIRED     → SUBMITTED
```

### 4. Side effects come after the guarded state change

Confirm with a conditional `updateMany` that includes the expected current
state in its `where`. If `count === 0`, throw — someone else got there first.
Only then issue tokens, send email, write events. Every send carries an
idempotency key of `${orderId}:${eventType}`.

### 5. Every server action starts with authorization

```ts
const admin = await requireAdmin();   // or requireStaff()
```

Middleware alone is not protection. An unprotected server action is a public
endpoint regardless of what the UI shows.

### 6. Every mutation writes an `OrderEvent`

Append-only. Never updated, never deleted. This is the only defence in a flow
where payment confirmation is a human judgement.

### 7. Prices and titles are snapshotted onto `OrderItem`

`unitPriceMinor` and `titleSnapshot` are copied at purchase time. When he
raises prices, historical orders must not change value.

### 8. No secrets in the repo

Env vars only. No API keys, no merchant numbers, no seed passwords in
committed files.

---

## Architecture

Three layers. Do not add a fourth.

```
server action    →  auth, Zod validation, response shaping
  service        →  business rules, state transitions, side effects
    prisma       →  data access
```

- Server Components by default. `"use client"` only for browser APIs,
  interactive state, event handlers or client hooks.
- **Never convert a whole page to a Client Component because one small part of
  it is interactive. Extract that part into its own leaf component and mark
  only that.** A `"use client"` at the top of a page pulls the entire subtree
  into the bundle, which is how the 200KB budget gets blown without anyone
  noticing.
- Mutations are server actions with Zod schemas. No API routes for internal
  work; API routes only for webhooks and file downloads.
- `revalidatePath` after writes. No client-side refetching.
- Route groups: `(marketing)` public, `(shop)` checkout and orders,
  `(admin)` protected.

### Payment providers

All payment work goes through the `PaymentProvider` interface. The manual
mobile money provider is the launch implementation and stays permanently as a
fallback. When ZynlePay or Pesapal onboarding clears, it becomes a second
implementation — **no fulfilment logic changes**.

Fulfilment logic must never live in an admin controller. The admin confirm
action emits the same internal `PaymentEvent` a gateway webhook would, into the
same handler.

---

## Launch (`LaunchEvent` / `Registration`)

Capacity is capped (first 200 delegates). **Count-then-insert oversells.** Use
a conditional decrement inside a transaction:

```ts
const claimed = await tx.launchEvent.updateMany({
  where: { id, seatsRemaining: { gt: 0 } },
  data:  { seatsRemaining: { decrement: 1 } },
});
if (claimed.count === 0) → waitlist instead of confirm
```

**This service does not exist yet — it is specified, not built.** When writing
`lib/services/registration.ts`, three behaviours below are deliberate and must
survive any later refactor:

- Cancellation **either** promotes the waitlist head **or** increments
  `seatsRemaining` — never both, or the same seat is issued twice.
- A repeat submission returns the existing registration rather than throwing,
  because people double-tap on bad connections.
- A previously `CANCELLED` row is revived on re-registration, because
  `@@unique([eventId, email])` would otherwise lock that email out forever.

Check-in is a **searchable list with a big button per row**. No QR scanning at
launch: it needs camera permission, decent light and a live connection, and if
any of those fail at the door there is a queue of people and no fallback.

A second check-in scan returns `ALREADY_CHECKED_IN` as a neutral state, not an
error. Nobody on a door with a queue behind them should be reading a red banner.

Assume venue wifi is bad. Provide a delegate CSV export he can print the
morning of. Check-in must degrade to paper.

---

## Admin

The admin is a **tool, not a brochure**. It does not use the brand palette.

- Neutral greys, high contrast, dense spacing, no decorative type
- Thin green header bar is the only brand tie-in
- **Mobile-first for real.** Claim review fits one phone viewport with no scroll
- Amount input: `inputmode="numeric"`, numeric keypad
- Primary action sits in a bottom bar within thumb reach, not at the top of a form
- Under 50KB of JS per admin page
- Component inventory is small: queue list, review panel, status badge, bottom
  action bar, empty state, confirm dialog. Build once, reuse.

**The Confirm button on a payment claim is disabled until the admin types the
amount they can see in the mobile money account.** This is the only working
control against fabricated transaction references. Do not add a one-click
confirm. Do not "improve" this.

---

## Copy

- Sentence case. Active voice. Plain verbs.
- Buttons say what happens: "Confirm payment", not "Submit".
- An action keeps its name through the whole flow — "Confirm payment" produces
  "Payment confirmed".
- Errors state what went wrong and what to do. They do not apologise and are
  never vague.
- Rejection reasons are shown verbatim to the buyer, so the wording in the
  fixed reason list must be customer-safe.

Avoid, as house style: all-caps eyebrow labels above sections; italicising one
word in a headline for emphasis; numbered markers on content that is not a
sequence; arrows appended to button text.

---

## Performance budget

Primary audience is on expensive mobile data in the Facebook in-app browser.

- Under 200KB above the fold on the homepage
- One variable font file per family, self-hosted and subsetted. **Never**
  `fonts.googleapis.com` in production
- Images: explicit dimensions, modern formats, sized to actual display size
- No hero video, no animation library
- Lighthouse 90+ on all four axes
- LCP under 2.5s on simulated 3G

---

## Accessibility

WCAG 2.1 AA, non-negotiable.

- Bright gold on white fails at ~1.5:1. Use `--gold-text` for gold-coloured
  text on light surfaces. Re-verify all pairings once real hexes are eyedropped.
- Visible keyboard focus on everything interactive
- `prefers-reduced-motion` respected
- Real labels on every input; placeholder is never the label

---

## Working method

- **Vertical slices, not layers.** "Register for the launch, end to end" beats
  "build all the models."
- Commit at every green state.
- Plan mode for anything touching payments, auth, or capacity.
- Schema changes are a conversation, not a unilateral edit.
- Do not refactor code you were not asked to touch.
- If a requirement is ambiguous, ask. Do not guess and build.

## Build order

1. Auth + `requireAdmin` / `requireStaff` seam
2. Launch registration + capacity logic + waitlist
3. Check-in screen + CSV export
4. `transitionPayment()` + tests
5. Books, orders, checkout, payment instructions page
6. Claim submission + normalisation + rate limits
7. Admin payment queue + claim review
8. Download tokens + watermarking + order status page
9. Transactional email
10. Print fulfilment queue
11. Unmatched payments, flags, content management

Items 1–3 are launch-critical. This ordering assumes the launch date is close;
confirm before deviating.

---

## Open items — do not invent answers

**Blocking the build order:**

- Launch date and venue
- **Name order.** The cover reads "CHENDELA YANGENI", LinkedIn reads "Yangeni
  Chendela", the launch logotype reads "Yangeni / CHENDELA". Pick one for the
  site title, nav logotype, OG tags and schema.org markup.
- **Is WANGA HR Consultancy actively trading?** His About text states an
  objective of *becoming* a consultant, but he has been its Director since
  2014. This determines whether the advisory page is an established firm with
  its own identity or a new offering under his personal brand.

**Blocking commerce:**

- Book prices per format, in kwacha
- Merchant mobile money numbers per network
- Delivery flat rates: Lusaka / rest of Zambia
- Real transaction ID formats from actual Airtel, MTN and Zamtel receipts —
  **write no validation regex until these are confirmed**
- Refund policy for digital goods
- Resend vs Brevo

**Blocking design:**

- Exact brand hex values and the logo as SVG
- Flat cover artwork (PNG or PDF) for both books — the 3D mockup is hero
  material only
- The rest of the *Level Up* photo shoot. Same suit, same location; a
  consistent set is worth more than any design decision available to us
- Whether the board-chair-then-HR-Director sequence at Lubona is a story he
  wants told