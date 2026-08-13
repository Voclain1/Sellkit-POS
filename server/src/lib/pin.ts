import crypto from 'crypto';
import bcrypt from 'bcryptjs';

/**
 * Cashier PIN storage.
 *
 * A 4-digit PIN has only 10k possible values, so bcrypt alone is a poor fit: it is
 * unqueryable, which forced the old pin-login to load every user with a PIN and
 * bcrypt-compare them one by one (O(n) hashes per login attempt).
 *
 * Stored format keeps both properties in the existing `User.pin` column:
 *
 *   v2:<lookup>:<secret>
 *
 *   lookup = HMAC-SHA256(pin, PIN_PEPPER)  -- deterministic, so a PIN can be looked
 *            up with a single indexed prefix query instead of scanning users.
 *   secret = bcrypt(pin)                   -- slow verify, so a leaked database alone
 *            does not hand over PINs even if the pepper leaks with it.
 *
 * The pepper lives in the environment, not the database. A database-only leak
 * therefore reveals neither the PIN nor a usable lookup value.
 *
 * bcrypt hashes use the alphabet [./A-Za-z0-9$], so ':' is a safe delimiter.
 */

const PIN_FORMAT_VERSION = 'v2';
const BCRYPT_ROUNDS = 10;

function pepper(): string {
  const value = process.env.PIN_PEPPER || process.env.JWT_SECRET;
  if (!value) {
    throw new Error(
      'PIN_PEPPER (or JWT_SECRET) must be set to hash or verify cashier PINs. See server/.env.example.'
    );
  }
  return value;
}

/** Deterministic, peppered lookup hash for a PIN. */
export function pinLookupHash(pin: string | number): string {
  return crypto.createHmac('sha256', pepper()).update(String(pin)).digest('hex');
}

/**
 * Prefix to match stored PINs against. Narrows a PIN to its (usually single)
 * candidate user in one query, with no bcrypt work.
 */
export function pinLookupPrefix(pin: string | number): string {
  return `${PIN_FORMAT_VERSION}:${pinLookupHash(pin)}:`;
}

/** Hash a PIN for storage. */
export async function hashPin(pin: string | number): Promise<string> {
  const lookup = pinLookupHash(pin);
  const secret = await bcrypt.hash(String(pin), BCRYPT_ROUNDS);
  return `${PIN_FORMAT_VERSION}:${lookup}:${secret}`;
}

/**
 * True for PINs written before the v2 format (a bare bcrypt hash). These still
 * verify, but cannot be looked up by PIN alone -- the caller must identify the
 * user first. Re-running the seed, or re-enrolling the PIN, upgrades them.
 */
export function isLegacyPin(stored: string): boolean {
  return !stored.startsWith(`${PIN_FORMAT_VERSION}:`);
}

/** Verify a submitted PIN against a stored value in either format. */
export async function verifyPin(pin: string | number, stored: string | null): Promise<boolean> {
  if (!stored) return false;

  if (isLegacyPin(stored)) {
    return bcrypt.compare(String(pin), stored).catch(() => false);
  }

  const [, lookup, secret] = stored.split(':');
  if (!lookup || !secret) return false;

  // Cheap constant-time reject before paying for bcrypt.
  const expected = Buffer.from(pinLookupHash(pin), 'utf8');
  const actual = Buffer.from(lookup, 'utf8');
  if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) {
    return false;
  }

  return bcrypt.compare(String(pin), secret).catch(() => false);
}
