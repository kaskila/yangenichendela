import { describe, expect, it } from "vitest";
import { toCsv } from "@/lib/csv";

describe("toCsv", () => {
  it("quotes every field and terminates rows with CRLF", () => {
    expect(toCsv(["a", "b"], [["1", "2"]])).toBe('"a","b"\r\n"1","2"\r\n');
  });

  it("keeps a comma inside a field from breaking the column structure", () => {
    const csv = toCsv(["Address"], [["Plot 5, Kabulonga, Lusaka"]]);
    expect(csv).toBe('"Address"\r\n"Plot 5, Kabulonga, Lusaka"\r\n');
  });

  it("doubles an embedded double quote", () => {
    const csv = toCsv(["Note"], [['He said "leave it at the gate"']]);
    expect(csv).toBe('"Note"\r\n"He said ""leave it at the gate"""\r\n');
  });

  it("keeps a newline inside a field", () => {
    const csv = toCsv(["Address"], [["House 12\nGreen Street\nNdola"]]);
    expect(csv).toBe('"Address"\r\n"House 12\nGreen Street\nNdola"\r\n');
  });

  it("handles all three together in one field", () => {
    const csv = toCsv(
      ["Reference", "Address"],
      [["YC-ABCDE", 'Plot 9, "the blue house"\nRoma, Lusaka']],
    );
    expect(csv).toBe(
      '"Reference","Address"\r\n"YC-ABCDE","Plot 9, ""the blue house""\nRoma, Lusaka"\r\n',
    );
  });
});
