"use client";

import { useState } from "react";

// Progressive enhancement only. The value it copies is always rendered as
// selectable text next to it, so a failed or unavailable clipboard costs the
// buyer nothing.
export function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard blocked (in-app browser, permissions) — text stays selectable.
    }
  }

  return (
    <button
      type="button"
      onClick={copy}
      aria-label={copied ? `${label} copied` : `Copy ${label}`}
      className="shrink-0 rounded border border-border px-2 py-1 text-xs font-medium text-ink!"
    >
      {copied ? "Copied" : "Copy"}
    </button>
  );
}
