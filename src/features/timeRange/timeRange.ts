import type { CustomDateRange, TimeRange } from "../../types/session";

export function getBeijingDate(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const valueOf = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  return `${valueOf("year")}-${valueOf("month")}-${valueOf("day")}`;
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function dateRangeBounds(
  range: TimeRange,
  now = new Date(),
  customRange?: CustomDateRange,
) {
  if (range === "all") {
    return null;
  }

  if (range === "custom") {
    if (!customRange) return null;
    return { start: customRange.start, end: customRange.end };
  }

  const today = getBeijingDate(now);

  if (range === "today") {
    return { start: today, end: today };
  }

  if (range === "yesterday") {
    const yesterday = getBeijingDate(addDays(now, -1));
    return { start: yesterday, end: yesterday };
  }

  const days = range === "7d" ? 6 : 29;
  return {
    start: getBeijingDate(addDays(now, -days)),
    end: today,
  };
}

export function isDateInTimeRange(
  date: string,
  range: TimeRange,
  now = new Date(),
  customRange?: CustomDateRange,
) {
  const bounds = dateRangeBounds(range, now, customRange);
  if (!bounds) {
    return true;
  }

  return date >= bounds.start && date <= bounds.end;
}

export function isIsoInTimeRange(
  iso: string,
  range: TimeRange,
  now = new Date(),
  customRange?: CustomDateRange,
) {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) {
    return false;
  }

  return isDateInTimeRange(getBeijingDate(parsed), range, now, customRange);
}
