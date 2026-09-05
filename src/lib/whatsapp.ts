// wa.me deep links for the fulfilment queue (docs §6.4). This is how Yangeni
// contacts buyers — a prefilled message he taps once. No API, just a link.
//
// The stored customerPhone is whatever the buyer typed at checkout (validation
// there is deliberately permissive — see orders.ts). Zambian mobile numbers are
// 9 digits after the country code (260); locally they're written with a leading
// 0 ("0977123456"). Normalise to the international form wa.me wants, and never
// throw — a best-effort digit string is still dialable.

export function toIntlZambianNumber(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.startsWith("260")) return digits;
  if (digits.startsWith("0")) return "260" + digits.slice(1);
  if (digits.length === 9) return "260" + digits;
  return digits;
}

export function buildWhatsAppLink(phone: string, message: string): string {
  return `https://wa.me/${toIntlZambianNumber(phone)}?text=${encodeURIComponent(message)}`;
}
