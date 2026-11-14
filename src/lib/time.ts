const JAKARTA_TIME_ZONE = "Asia/Jakarta";
const JAKARTA_OFFSET = "+07:00";

interface JakartaDateParts {
  year: string;
  month: string;
  day: string;
  hour: string;
  minute: string;
  second: string;
  millisecond: string;
}

const jakartaFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: JAKARTA_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

function extractJakartaParts(date: Date): JakartaDateParts {
  if (Number.isNaN(date.getTime())) {
    throw new RangeError("Invalid ISO timestamp for Jakarta time formatting");
  }

  const parts = jakartaFormatter.formatToParts(date);
  const lookup: Record<string, string> = {};
  for (const part of parts) {
    if (part.type !== "literal") {
      lookup[part.type] = part.value;
    }
  }

  return {
    year: lookup.year ?? "0000",
    month: lookup.month ?? "01",
    day: lookup.day ?? "01",
    hour: lookup.hour ?? "00",
    minute: lookup.minute ?? "00",
    second: lookup.second ?? "00",
    millisecond: String(date.getUTCMilliseconds()).padStart(3, "0"),
  };
}

export function nowJakartaIso(): string {
  const parts = extractJakartaParts(new Date());
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}.${parts.millisecond}${JAKARTA_OFFSET}`;
}

export function formatJakartaDateMMDDYYYY(isoTimestamp: string): string {
  const parts = extractJakartaParts(new Date(isoTimestamp));
  return `${parts.month}/${parts.day}/${parts.year}`;
}

export function formatJakartaTimeHHmmss(isoTimestamp: string): string {
  const parts = extractJakartaParts(new Date(isoTimestamp));
  return `${parts.hour}:${parts.minute}:${parts.second}`;
}
