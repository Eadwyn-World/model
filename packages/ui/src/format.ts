/**
 * Presentation helpers shared by Eadwyn surfaces.
 */

const UNITS: [number, Intl.RelativeTimeFormatUnit][] = [
  [60, "second"],
  [60, "minute"],
  [24, "hour"],
  [7, "day"],
  [4.34524, "week"],
  [12, "month"],
  [Number.POSITIVE_INFINITY, "year"],
];

/** "4 min ago", "2 d ago", "just now". Deterministic for a fixed `now`. */
export function formatRelativeTime(iso: string | null | undefined, now: number): string {
  if (!iso) return "never";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "unknown";
  let delta = Math.max(0, Math.round((now - then) / 1000));
  if (delta < 45) return "just now";
  const labels: Record<Intl.RelativeTimeFormatUnit, string> = {
    second: "s",
    seconds: "s",
    minute: "min",
    minutes: "min",
    hour: "h",
    hours: "h",
    day: "d",
    days: "d",
    week: "w",
    weeks: "w",
    month: "mo",
    months: "mo",
    quarter: "q",
    quarters: "q",
    year: "y",
    years: "y",
  };
  for (const [size, unit] of UNITS) {
    if (delta < size) {
      return `${delta} ${labels[unit]} ago`;
    }
    delta = Math.round(delta / size);
  }
  return `${delta} y ago`;
}

/** 1284 -> "1.3K", 118400 -> "118K", 12 -> "12". */
export function formatCompact(value: number): string {
  return new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(
    value,
  );
}

export function formatInteger(value: number): string {
  return new Intl.NumberFormat("en").format(value);
}

/** 2026-09-23T15:26:22.670Z -> "2026-09-23 15:26 UTC" */
export function formatUtc(iso: string | null | undefined): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return `${date.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}
