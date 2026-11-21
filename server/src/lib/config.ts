/**
 * Sales tax applied to every sale, as a fraction (0.08 = 8%).
 *
 * The till is told this rate by /api/bootstrap and the checkout re-derives tax
 * with it, so both sides compute the same figure from one value. Set TAX_RATE in
 * the environment to change it.
 */
export const TAX_RATE: number = (() => {
  const raw = process.env.TAX_RATE;
  if (raw === undefined || raw.trim() === '') return 0.08;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
    throw new Error(`TAX_RATE must be a fraction between 0 and 1 (got ${JSON.stringify(raw)})`);
  }
  return parsed;
})();
