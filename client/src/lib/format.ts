/** Shared display formatting for the back office. */

/** `$1,234.50`. Prices arrive from Prisma as Decimal-backed strings, so coerce first. */
export const money = (value: number | string): string =>
  `$${Number(value ?? 0).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

/** Whole units — stock counts and order counts are never fractional. */
export const count = (value: number | string): string =>
  Number(value ?? 0).toLocaleString(undefined, { maximumFractionDigits: 0 });

/** A trend bucket key (local YYYY-MM-DD) as a short axis label. */
export const shortDay = (isoDate: string): string => {
  const [y, m, d] = isoDate.split('-').map(Number);
  if (!y || !m || !d) return isoDate;
  // Constructed as a local date: `new Date('2026-08-20')` parses as UTC and can
  // render as the previous day west of Greenwich.
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};
