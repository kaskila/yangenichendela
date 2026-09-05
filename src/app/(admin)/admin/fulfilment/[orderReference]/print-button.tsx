"use client";

// Enhancement only — Ctrl/Cmd-P prints the page without this. Hidden from the
// printout itself via .no-print (globals.css).
export function PrintButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="no-print rounded border border-admin-border px-4 py-2 text-sm font-medium text-admin-ink!"
    >
      Print this slip
    </button>
  );
}
