/**
 * A fresh id for one sale, generated on the till before the first POST.
 *
 * The server treats it as an idempotency key: if a checkout succeeds but its
 * response is lost and the offline queue sends it again, the replay returns the
 * original sale instead of recording a second one.
 */
export function newClientSaleId(): string {
  // randomUUID needs a secure context (https or localhost), which an installed
  // PWA always has; getRandomValues covers anything else.
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();

  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
