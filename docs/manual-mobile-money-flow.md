# Manual Mobile Money Payment Flow — Design Spec

**Project:** Yangeni Chendela author & consulting platform
**Component:** `ManualMobileMoneyProvider` (implements `PaymentProvider`)
**Status:** Design — to be reviewed before implementation
**Owner:** Engineering

---

## 1. Why this exists

Merchant gateway onboarding (ZynlePay / Pesapal) requires KYC verification we
cannot start without the client's company documents. This flow lets the store
take real money on launch day with no gateway dependency, using the payment
rails Zambian buyers already use daily.

It is **not** throwaway code. It stays in production permanently as:

- the fallback when the automated gateway is down or rejecting,
- the reconciliation path for payments that arrive without a matching order,
- the admin queue that print fulfilment needs anyway.

**Core principle:** the system never asserts that money arrived. Only a human
who has looked at the actual mobile money account asserts that. Everything the
buyer submits is an unverified *claim*.

---

## 2. Two state machines, not one

A common mistake is a single `status` column. Payment and fulfilment are
independent — a print order can be paid but not yet dispatched, and an ebook
order is fulfilled the instant payment confirms. Model them separately.

### 2.1 `PaymentState`

| State | Meaning | Set by |
|---|---|---|
| `PENDING` | Order created, buyer has not submitted a reference | System |
| `SUBMITTED` | Buyer claims to have paid, gave a reference | Buyer |
| `CONFIRMED` | Admin matched the payment in the real account | Admin |
| `REJECTED` | Admin could not match; claim refused | Admin |
| `UNDERPAID` | Matched, but amount is short of the order total | Admin |
| `EXPIRED` | Payment window elapsed with no valid claim | System (cron) |
| `CANCELLED` | Buyer or admin cancelled before confirmation | Either |
| `REFUNDED` | Money returned after confirmation | Admin |

**Legal transitions**

```
PENDING     → SUBMITTED | EXPIRED | CANCELLED
SUBMITTED   → CONFIRMED | REJECTED | UNDERPAID | EXPIRED
REJECTED    → SUBMITTED            (buyer may retry with a corrected reference)
UNDERPAID   → CONFIRMED | REFUNDED (buyer tops up, or we return it)
CONFIRMED   → REFUNDED
EXPIRED     → SUBMITTED            (admin may reopen on request)
```

Everything else is illegal and must throw. Enforce in a single
`transitionPayment()` function — never let a route handler write the column
directly.

### 2.2 `FulfilmentState`

| State | Applies to | Meaning |
|---|---|---|
| `NOT_STARTED` | both | Payment not yet confirmed |
| `DELIVERED_DIGITAL` | ebook | Download token issued and emailed |
| `AWAITING_PACKING` | print | Confirmed, in the queue |
| `PACKED` | print | Ready to go out |
| `DISPATCHED` | print | With courier / out for delivery |
| `DELIVERED` | print | Buyer has it |
| `RETURNED` | print | Failed delivery |

Fulfilment may only advance past `NOT_STARTED` when
`paymentState === CONFIRMED`. Guard this in code, not just convention.

A mixed-cart order (ebook + print in one purchase) fulfils the digital half
immediately on confirmation and the physical half through the queue. Model
fulfilment state **per order item**, not per order, or mixed carts break.

---

## 3. Buyer-facing flow

### Step 1 — Checkout
Buyer enters name, email, phone. For print items, delivery address and zone
(Lusaka / rest of Zambia, flat rate each). Order is created with
`PaymentState.PENDING` and a short human-readable reference.

**Reference format:** `YC-7K3M9` — prefix, hyphen, 5 chars from an
unambiguous alphabet (`ABCDEFGHJKLMNPQRSTUVWXYZ23456789` — no `0/O`, `1/I/L`).
This gets typed into a phone keypad and read aloud over WhatsApp. Short and
unambiguous matters more than entropy here; collision risk is handled by a
unique constraint and retry.

### Step 2 — Payment instructions
Full-page instructions, not a modal. Must show:

- The exact amount in kwacha, large, with a copy button.
- The merchant number per network (Airtel / MTN / Zamtel), each with a copy button.
- The order reference, with instructions to use it as the payment reference
  where the network allows it.
- A plain-language step list per network.
- The expiry time, as an absolute local time ("expires 14:32 today"), not a
  countdown — buyers close the tab and come back.

This page must be reachable again later. Email the link. Do not trap it behind
session state; a magic-link token in the URL is enough.

### Step 3 — Claim submission
Buyer returns and enters: network used, the sending phone number, and the
transaction ID from their SMS receipt. Optionally uploads a screenshot of the
receipt (Cloudinary, private, admin-only) — this materially speeds up admin
matching and should be encouraged but never required.

State → `SUBMITTED`.

### Step 4 — Wait
Confirmation screen sets expectations honestly: manual review, typical time,
what happens next. Do not imply instant delivery.

### Step 5 — Outcome
Confirmed → ebook download link emailed; print order enters the queue.
Rejected → email explaining why, with a link to resubmit.

---

## 4. Data model

```prisma
model Order {
  id              String   @id @default(cuid())
  reference       String   @unique              // YC-7K3M9
  accessToken     String   @unique              // magic link for status page

  customerName    String
  customerEmail   String
  customerPhone   String

  currency        String   @default("ZMW")
  subtotalMinor   Int                           // integer minor units, always
  deliveryMinor   Int      @default(0)
  totalMinor      Int

  paymentState    PaymentState    @default(PENDING)
  paymentExpiresAt DateTime

  deliveryZone    DeliveryZone?
  deliveryAddress String?

  items           OrderItem[]
  claims          PaymentClaim[]
  events          OrderEvent[]

  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  @@index([paymentState, createdAt])
}

model OrderItem {
  id              String   @id @default(cuid())
  orderId         String
  order           Order    @relation(fields: [orderId], references: [id])
  bookFormatId    String
  bookFormat      BookFormat @relation(fields: [bookFormatId], references: [id])

  titleSnapshot   String                        // denormalised at purchase time
  formatSnapshot  BookFormatType
  unitPriceMinor  Int                           // price AT purchase, not current
  quantity        Int

  fulfilmentState FulfilmentState @default(NOT_STARTED)
  dispatchedAt    DateTime?
  trackingNote    String?
}

model PaymentClaim {
  id              String   @id @default(cuid())
  orderId         String
  order           Order    @relation(fields: [orderId], references: [id])

  network         MobileNetwork
  senderPhone     String
  transactionId       String                    // as typed by buyer
  transactionIdNorm   String                    // normalised for matching
  receiptImageUrl String?

  status          ClaimStatus @default(PENDING_REVIEW)
  reviewedById    String?
  reviewedAt      DateTime?
  reviewNote      String?
  matchedAmountMinor Int?                       // what actually arrived

  createdAt       DateTime @default(now())
  ipAddress       String?

  @@unique([network, transactionIdNorm])        // the anti-duplicate constraint
  @@index([status, createdAt])
}

model OrderEvent {                              // append-only audit log
  id          String   @id @default(cuid())
  orderId     String
  order       Order    @relation(fields: [orderId], references: [id])
  type        String                            // payment.confirmed, email.sent, ...
  fromState   String?
  toState     String?
  actorType   ActorType                         // SYSTEM | BUYER | ADMIN
  actorId     String?
  metadata    Json?
  createdAt   DateTime @default(now())

  @@index([orderId, createdAt])
}

enum PaymentState  { PENDING SUBMITTED CONFIRMED REJECTED UNDERPAID EXPIRED CANCELLED REFUNDED }
enum ClaimStatus   { PENDING_REVIEW ACCEPTED REJECTED DUPLICATE_FLAGGED }
enum MobileNetwork { AIRTEL MTN ZAMTEL }
enum ActorType     { SYSTEM BUYER ADMIN }
```

**Three things worth defending in review:**

`PaymentClaim` is a separate table, not columns on `Order`. A buyer who
fat-fingers a transaction ID submits a second claim. We need the history of
both, including the rejected one, when a dispute arrives three weeks later.

`unitPriceMinor` and `titleSnapshot` are denormalised onto `OrderItem`.
When the client raises prices, historical orders must not silently change
value. This is the single most common ecommerce data bug.

`OrderEvent` is append-only and never updated. It is the answer to "the buyer
says he paid and you never sent the book" — the only defence we have in a flow
where trust is manual.

---

## 5. Fraud and edge cases

This is the section that matters. Each case: what happens, what we do.

### 5.1 Duplicate transaction ID
Buyer submits a reference already used on another order — either recycling
their own genuine receipt, or a reference shared between people.

**Handling:** the `@@unique([network, transactionIdNorm])` constraint rejects
it at the database. Catch the constraint violation and do **not** show a raw
error. Show: "This transaction reference has already been submitted. If you
believe this is a mistake, contact us." Log an `OrderEvent` of type
`claim.duplicate_attempt` with both order IDs, and surface it on an admin
**Flags** screen. Repeat offenders from one IP or email are a signal worth
having visible.

Deliberately *not* auto-blocking: a genuine buyer who paid once for two books
in separate orders will hit this, and refusing them outright loses a sale.
Flag for human eyes.

### 5.2 Normalisation before comparison
Buyers type references with spaces, dashes, mixed case, and sometimes the
whole SMS pasted in. Without normalisation the unique constraint is useless.

```ts
function normaliseTransactionId(raw: string): string {
  return raw
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")   // strip spaces, dots, dashes
    .trim();
}
```

Store both raw and normalised. Match on normalised. Show raw to the admin so
they can see what the buyer actually typed.

**Open item:** confirm the real transaction ID formats from actual Airtel, MTN
and Zamtel receipts before writing any validation regex. Do not guess a format
and reject valid references — a false rejection at checkout is worse than
accepting junk and letting the admin catch it. Until confirmed, validate only
on length bounds (say 6–30 chars after normalisation) and non-empty.

### 5.3 Amount mismatch — underpayment
Buyer sends K150 against a K250 order. Money is real, order is not covered.

**Handling:** admin enters `matchedAmountMinor` when reviewing, and the UI
compares it against `totalMinor` rather than assuming. If short →
`PaymentState.UNDERPAID`, no fulfilment, automated email stating the amount
received, the shortfall, and how to top up. A top-up is a second
`PaymentClaim` against the same order; admin confirms when the sum covers the
total.

### 5.4 Amount mismatch — overpayment
Less common, more annoying. Admin may confirm and fulfil, then either refund
the difference or issue credit. Record the overage in `reviewNote`. Never
silently pocket it — this is a personal-brand business and a bad story travels.

### 5.5 Fabricated reference
Buyer invents a plausible-looking transaction ID hoping the admin waves it
through.

**Handling:** there is no technical defence. The defence is procedural: the
admin **must** match against the actual mobile money account before confirming.
Build the admin UI so that confirming requires entering the observed amount —
you cannot confirm without having looked. Do not add a one-click "Confirm"
button that lets a tired human approve a queue in ten seconds.

Rate-limit claim submissions: max 3 claims per order, max 5 per email per hour,
max 10 per IP per hour. Beyond that, `429` and a flag.

### 5.6 Payment to the wrong number
Buyer sends to the client's personal number instead of the business one, or to
a stale number from an old screenshot.

**Handling:** keep merchant numbers in a config table, not hardcoded, with an
`active` flag. Admin can mark a claim as received on a secondary number and
still confirm. Keep the instruction page numbers as the single source of truth
and never let them drift from what's configured.

### 5.7 Double confirmation race
Two admins (or one admin double-clicking) confirm the same claim, issuing two
download tokens and two emails.

**Handling:** the confirmation action runs in a transaction with a conditional
update:

```ts
const updated = await prisma.order.updateMany({
  where: { id: orderId, paymentState: "SUBMITTED" },  // guard clause
  data:  { paymentState: "CONFIRMED" },
});
if (updated.count === 0) {
  throw new ConflictError("Order is no longer awaiting confirmation");
}
// only now: issue tokens, send email, write event
```

Side effects happen strictly after the guarded state change succeeds. Email
sending is keyed on an idempotency key of `${orderId}:payment.confirmed` so a
retry cannot double-send.

### 5.8 Money arrives before the claim, or with no claim at all
Buyer pays but never returns to submit a reference. Money sits in the account
unmatched.

**Handling:** admin needs an **Unmatched Payments** screen where they can
record a payment observed in the account and search open orders by amount,
phone number, or buyer name to attach it manually. This is the reconciliation
path, and without it the client will have money he can't tie to orders within
the first month.

### 5.9 Order expiry while payment is in flight
Buyer pays at 14:31, order expires at 14:32, claim submitted at 14:35.

**Handling:** expiry sets `EXPIRED` but must never delete the order or release
anything. `EXPIRED → SUBMITTED` is a legal transition. Set the window
generously — 48 hours, not 30 minutes. There is no inventory being held
hostage for ebooks, and for print the stock levels are small enough to manage
by hand. Send a reminder email at the halfway mark.

### 5.10 Ebook link sharing
Download link forwarded, or posted publicly.

**Handling, layered:** signed URLs expiring in 24 hours, regenerable from the
order status page via magic link. Max 5 downloads per token, counter
incremented server-side. PDF watermarked on the footer of each page with the
buyer's name, email and order reference — this is the actual deterrent; the
expiry is just hygiene. Log every download with IP and timestamp; a token
pulled from 40 distinct IPs is visible on the admin order detail.

Do not attempt real DRM. It fails, it costs weeks, and it punishes legitimate
buyers.

### 5.11 Refund after digital delivery
Buyer downloads the ebook then asks for their money back.

**Handling:** policy decision for the client, not for us — but the system must
support it. `CONFIRMED → REFUNDED` revokes all active download tokens
immediately and records the refund with a note. Surface the download log on
the refund screen so the client can see whether the file was actually taken
before deciding.

### 5.12 Spam order creation
Bots creating thousands of `PENDING` orders, polluting the queue and the
reference space.

**Handling:** orders are cheap and expire on their own, so this is low
severity. Rate-limit order creation per IP, add a honeypot field to the
checkout form, and default the admin queue to filter out `PENDING` orders with
no claim. Do not add a CAPTCHA at launch — it costs conversion and this
threat is theoretical for an author's bookstore.

### 5.13 Email delivery failure
Confirmation email bounces or lands in spam. Buyer paid and got nothing.

**Handling:** the order status page is the source of truth, always reachable
by magic link, and always shows the current download link. Every email is a
convenience, never the only delivery mechanism. Log send failures as
`OrderEvent` and show a bounce indicator on the admin order detail so the
client can follow up by WhatsApp.

---

## 6. Admin screens

### 6.1 Payment queue (default landing)
Table of claims in `PENDING_REVIEW`, oldest first. Columns: order reference,
buyer name, amount due, network, transaction ID as typed, submitted time, age.
Age badge turns amber past 6 hours, red past 24. Filters for network, state,
flagged. Search across reference, transaction ID, phone, email, name.

### 6.2 Claim review (the important one)
Single claim, everything needed to decide on one screen:

- Order summary, items, amount due, prominently displayed.
- Buyer's submitted details, with the receipt screenshot inline if uploaded.
- **A required numeric input: "Amount you can see in the account."** The
  Confirm button is disabled until it is filled. This is the design decision
  that keeps the human honest.
- If entered amount < due → the primary action changes to "Mark underpaid".
- If entered amount > due → confirm remains available, with an overpayment
  warning and a mandatory note.
- Reject action requires a reason from a fixed list (reference not found,
  amount mismatch, duplicate, other) plus optional free text. The reason is
  used verbatim in the buyer's email, so the list wording must be
  customer-safe.
- Full order event timeline down the side.

### 6.3 Unmatched payments
Record a payment seen in the account with no claim attached. Then search open
orders by amount, phone, or name and attach it. Creates a system-actor claim
and confirms in one action.

### 6.4 Fulfilment queue (print)
Kanban or filtered list across `AWAITING_PACKING → PACKED → DISPATCHED →
DELIVERED`. Printable picking slip. A WhatsApp deep link
(`https://wa.me/26097XXXXXXX?text=...`) prefilled with order reference and
status — the client will use this constantly and it costs us twenty minutes.

### 6.5 Flags
Duplicate attempts, rate-limit hits, orders with unusual download activity.
Low priority for launch; stub the page and populate it as signals accumulate.

---

## 7. Email triggers

| Trigger | To | Contains |
|---|---|---|
| `order.created` | Buyer | Payment instructions, amount, merchant numbers, reference, link back to instructions page |
| `order.created` | Admin | New order notification (digest, not per-order, past a threshold) |
| `claim.submitted` | Buyer | "We've received your reference, reviewing shortly" |
| `claim.submitted` | Admin | Action needed — immediate, this one is time-sensitive |
| `payment.confirmed` (digital) | Buyer | Receipt + download link |
| `payment.confirmed` (print) | Buyer | Receipt + delivery expectation |
| `payment.underpaid` | Buyer | Amount received, shortfall, how to top up |
| `payment.rejected` | Buyer | Reason, link to resubmit |
| `order.reminder` | Buyer | Halfway to expiry, unpaid |
| `order.expired` | Buyer | Expired, link to reorder |
| `fulfilment.dispatched` | Buyer | On its way, delivery note |
| `payment.refunded` | Buyer | Refund confirmation |

Every email carries the magic-link status page URL. Every send writes an
`OrderEvent` with the idempotency key. Use React Email templates and Resend, or
Brevo if the client wants the newsletter and transactional mail in one place —
worth checking, since a newsletter platform is already in his orbit.

---

## 8. Provider interface implementation

```ts
export class ManualMobileMoneyProvider implements PaymentProvider {
  async createCheckout(order: Order) {
    return {
      redirectUrl: `/orders/${order.reference}/pay?t=${order.accessToken}`,
      reference: order.reference,
    };
  }

  async verifyPayment(reference: string): Promise<PaymentStatus> {
    const order = await getOrderByReference(reference);
    return mapPaymentState(order.paymentState);  // no external call
  }

  async handleWebhook(): Promise<PaymentEvent> {
    throw new NotSupportedError(
      "Manual provider has no webhook; confirmation is an admin action"
    );
  }
}
```

The admin confirmation action emits the same internal `PaymentEvent` that a
gateway webhook would, into the same handler. When ZynlePay lands, the
fulfilment pipeline downstream is untouched. That is the whole point of the
abstraction, and it is worth being strict about: **no fulfilment logic lives in
the admin controller.**

---

## 9. Build order

1. Schema, enums, `transitionPayment()` with the legal-transition table and tests.
2. Order creation + reference generator + instructions page.
3. Claim submission + normalisation + unique constraint + rate limits.
4. Admin queue and claim review screen.
5. Confirmation transaction, guarded update, event log.
6. Download tokens + watermarking + status page.
7. Emails.
8. Unmatched payments and fulfilment queue.
9. Flags.

Items 1–6 are launch-critical. 7 is close behind. 8 and 9 can land in week
three.

---

## 10. Open questions for the client

- The merchant numbers for each network, and whether they are personal or
  registered business lines.
- Book prices in kwacha, per format.
- Delivery flat rates for Lusaka and elsewhere.
- Refund policy for digital goods — needed for the terms page and for 5.11.
- Who monitors the payment queue, and what response time do we promise buyers
  on the confirmation screen? Everything about the buyer experience hangs on
  the honesty of that number.