// RFC 4180 CSV serialisation. Every field is quoted unconditionally, so a comma,
// a double quote (doubled) or a newline inside a field can never break the row
// or column structure — the one thing this exists to guarantee. Rows end with
// CRLF, which is what spreadsheet software expects.

function quoteField(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

export function toCsv(headers: readonly string[], rows: readonly (readonly string[])[]): string {
  const lines = [headers, ...rows].map((row) => row.map(quoteField).join(","));
  return lines.join("\r\n") + "\r\n";
}
