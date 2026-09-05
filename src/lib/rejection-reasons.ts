// Fixed, customer-safe rejection reasons (docs/manual-mobile-money-flow.md
// §5.5 / §6.2). A standalone module with NO other imports so it can be
// pulled into a client component (the reject form renders these as radio
// labels) without dragging @/lib/db — and the Node/pg driver behind it —
// into the browser bundle. claim-review.ts (server-side) imports this same
// list to validate the submitted code, so the two can never drift apart.

export type RejectionReasonCode =
  | "reference_not_found"
  | "amount_mismatch"
  | "duplicate"
  | "other";

export const REJECTION_REASONS: { code: RejectionReasonCode; label: string }[] = [
  {
    code: "reference_not_found",
    label:
      "We could not find this reference in the account — please check it against your SMS and try again.",
  },
  {
    code: "amount_mismatch",
    label: "The amount received does not match this order's total.",
  },
  {
    code: "duplicate",
    label: "This transaction reference was already used on another order.",
  },
  { code: "other", label: "Other" },
];
