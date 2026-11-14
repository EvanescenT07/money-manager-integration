import { describe, expect, it } from "bun:test";
import ExcelJS from "exceljs";
import { REALBYTE_COLUMNS, buildRealbyteWorkbookBuffer } from "../src/lib/xlsx";
import type { TransactionLogItem } from "../src/types/logs";

async function loadWorkbookFromNodeBuffer(
  buffer: Buffer
): Promise<ExcelJS.Workbook> {
  const workbook = new ExcelJS.Workbook();
  const copy = new Uint8Array(buffer.byteLength);
  copy.set(buffer);
  await workbook.xlsx.load(copy.buffer as unknown as ExcelJS.Buffer);
  return workbook;
}

function getRowCellStrings(row: ExcelJS.Row, columnCount: number): string[] {
  const values: string[] = [];
  for (let col = 1; col <= columnCount; col += 1) {
    const cellValue = row.getCell(col).value;
    values.push(cellValue === null || cellValue === undefined ? "" : String(cellValue));
  }
  return values;
}

describe("Realbyte XLSX Export", () => {
  it("defines exact 11 Realbyte Money Manager column headers", () => {
    expect([...REALBYTE_COLUMNS]).toEqual([
      "Date",
      "Account",
      "Category",
      "Subcategory",
      "Note",
      "Amount",
      "Income/Expense",
      "Tag",
      "Description",
      "Amount Sub",
      "Currency",
    ]);
  });

  it("writes only header row when logs have no parsedData", async () => {
    const logs: TransactionLogItem[] = [
      {
        id: "promo-1",
        timestamp: "2026-11-14T10:00:00+07:00",
        source: "MACRODROID",
        rawInput: "Promo Cashback 50% hanya hari ini!",
        status: "IGNORED_PROMO",
        latencyMs: 420,
      },
      {
        id: "failed-1",
        timestamp: "2026-11-14T11:00:00+07:00",
        source: "TELEGRAM_OCR",
        rawInput: "blurry photo",
        status: "FAILED",
        latencyMs: 910,
        errorMessage: "Unable to parse amount",
      },
    ];

    const buffer = await buildRealbyteWorkbookBuffer(logs);
    expect(Buffer.isBuffer(buffer)).toBe(true);
    expect(buffer.byteLength).toBeGreaterThan(0);

    const workbook = await loadWorkbookFromNodeBuffer(buffer);
    const sheet = workbook.worksheets[0];
    expect(sheet).toBeDefined();
    expect(sheet.rowCount).toBe(1);
    expect(getRowCellStrings(sheet.getRow(1), 11)).toEqual([...REALBYTE_COLUMNS]);
  });

  it("formats Asia/Jakarta MM/DD/YYYY dates, integer amounts, and Realbyte fields", async () => {
    const logs: TransactionLogItem[] = [
      {
        id: "tx-1",
        timestamp: "2026-05-01T18:30:00.000Z", // 2026-05-02 01:30:00 Asia/Jakarta
        source: "MACRODROID",
        appName: "Bank Jago",
        rawInput: "Pembayaran QRIS Kopi Kenangan Rp24.500",
        status: "RECORDED",
        latencyMs: 780,
        parsedData: {
          type: "Expense",
          account: "Jago",
          category: "Food",
          subcategory: "Coffee",
          amount: 24500.4,
          currency: "IDR",
          note: "kopi kenangan",
          description: "qris pagi",
        },
      },
      {
        id: "tx-skip",
        timestamp: "2026-05-02T09:00:00+07:00",
        source: "MACRODROID",
        rawInput: "OTP 998123",
        status: "IGNORED_PROMO",
        latencyMs: 310,
      },
      {
        id: "tx-2",
        timestamp: "2026-11-14T23:45:00+07:00",
        source: "TELEGRAM_TEXT",
        rawInput: "dividen stockbit 150000",
        status: "SENT_TO_PHONE",
        latencyMs: 650,
        parsedData: {
          type: "Income",
          account: "Rdn Stockbit",
          category: "Investment",
          subcategory: "Stockbit",
          amount: 150000,
          currency: "IDR",
          note: "dividen bbca",
          description: "",
        },
      },
      {
        id: "tx-3",
        timestamp: "2026-11-15T00:05:00+07:00",
        source: "TELEGRAM_OCR",
        rawInput: "tiket bioskop",
        status: "RECORDED",
        latencyMs: 1120,
        parsedData: {
          type: "Expense",
          account: "Shopeepay",
          category: "Entertaiment",
          subcategory: "Movie",
          amount: 55000,
          currency: "IDR",
          note: "bioskop xxi",
          description: "",
        },
      },
    ];

    const buffer = await buildRealbyteWorkbookBuffer(logs);
    const workbook = await loadWorkbookFromNodeBuffer(buffer);
    const sheet = workbook.worksheets[0];
    expect(sheet).toBeDefined();
    expect(sheet.rowCount).toBe(4);

    const row2 = sheet.getRow(2);
    expect(getRowCellStrings(row2, 11)).toEqual([
      "05/02/2026",
      "Jago",
      "Food",
      "Coffee",
      "kopi kenangan",
      "24500",
      "Expense",
      "",
      "qris pagi",
      "",
      "IDR",
    ]);
    expect(typeof row2.getCell(6).value).toBe("number");
    expect(Number.isInteger(row2.getCell(6).value)).toBe(true);

    const row3 = sheet.getRow(3);
    expect(getRowCellStrings(row3, 11)).toEqual([
      "11/14/2026",
      "Rdn Stockbit",
      "Investment",
      "Stockbit",
      "dividen bbca",
      "150000",
      "Income",
      "",
      "",
      "",
      "IDR",
    ]);

    const row4 = sheet.getRow(4);
    expect(getRowCellStrings(row4, 11)).toEqual([
      "11/15/2026",
      "Shopeepay",
      "Entertaiment",
      "Movie",
      "bioskop xxi",
      "55000",
      "Expense",
      "",
      "",
      "",
      "IDR",
    ]);
  });
});
