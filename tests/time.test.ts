import { afterEach, describe, expect, it, setSystemTime } from "bun:test";
import {
  formatJakartaDateMMDDYYYY,
  formatJakartaTimeHHmmss,
  nowJakartaIso,
} from "../src/lib/time";

describe("Asia/Jakarta Time Utilities", () => {
  afterEach(() => {
    setSystemTime();
  });

  it("formats current Jakarta ISO-8601 timestamp with +07:00 offset", () => {
    setSystemTime(new Date("2026-05-01T18:05:09.042Z"));
    expect(nowJakartaIso()).toBe("2026-05-02T01:05:09.042+07:00");
  });

  it("converts UTC boundary timestamps to Jakarta MM/DD/YYYY and HH:mm:ss", () => {
    expect(formatJakartaDateMMDDYYYY("2026-12-31T17:30:00.000Z")).toBe(
      "01/01/2027"
    );
    expect(formatJakartaTimeHHmmss("2026-12-31T17:30:05.000Z")).toBe(
      "00:30:05"
    );
    expect(formatJakartaDateMMDDYYYY("2026-11-14T23:59:59+07:00")).toBe(
      "11/14/2026"
    );
    expect(formatJakartaTimeHHmmss("2026-11-14T23:59:59+07:00")).toBe(
      "23:59:59"
    );
  });

  it("throws RangeError on invalid timestamp input", () => {
    expect(() => formatJakartaDateMMDDYYYY("not-a-date")).toThrow(RangeError);
    expect(() => formatJakartaTimeHHmmss("invalid")).toThrow(RangeError);
  });
});
