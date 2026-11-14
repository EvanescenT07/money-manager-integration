import ExcelJS from "exceljs";
import type { TransactionLogItem } from "@/types/logs";
import { formatJakartaDateMMDDYYYY } from "./time";

export const REALBYTE_COLUMNS = [
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
] as const;

export async function buildRealbyteWorkbookBuffer(
  logs: TransactionLogItem[]
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "MM-AutoSync";
  workbook.created = new Date();

  const worksheet = workbook.addWorksheet("Money Manager");
  worksheet.addRow([...REALBYTE_COLUMNS]);

  for (const log of logs) {
    if (!log.parsedData) {
      continue;
    }

    const parsed = log.parsedData;
    worksheet.addRow([
      formatJakartaDateMMDDYYYY(log.timestamp),
      parsed.account,
      parsed.category,
      parsed.subcategory,
      parsed.note,
      Math.round(parsed.amount),
      parsed.type,
      "",
      parsed.description ?? "",
      "",
      "IDR",
    ]);
  }

  const rawBuffer = await workbook.xlsx.writeBuffer();
  if (Buffer.isBuffer(rawBuffer)) {
    return rawBuffer;
  }
  return Buffer.from(rawBuffer as ArrayBuffer);
}
