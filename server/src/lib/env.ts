/**
 * Security-relevant configuration, validated once at startup.
 *
 * Anything here that is missing or unsafe stops the server from starting.
 * A server that boots with a guessable JWT secret or a wide-open CORS policy
 * looks healthy and is not, so failing loudly at deploy time is the point.
 */

const isProduction = process.env.NODE_ENV === 'production';

const MIN_SECRET_LENGTH = 32;

/** The JWT signing secret. There is deliberately no fallback value. */
export function jwtSecret(): string {
  const value = process.env.JWT_SECRET ?? '';
  if (value.length < MIN_SECRET_LENGTH) {
    throw new Error(
      `JWT_SECRET must be set to at least ${MIN_SECRET_LENGTH} characters (got ${value.length}). ` +
        "Generate one with: node -e \"console.log(require('crypto').randomBytes(48).toString('base64url'))\""
    );
  }
  return value;
}

/**
 * Browser origins allowed to call the API, from CORS_ORIGINS (comma-separated).
 *
 * An entry may contain `*`, which matches one run of letters, digits and
 * hyphens -- enough for Vercel preview URLs such as
 * `https://sellkit-pos-*-voclain1s-projects.vercel.app`, but never a dot, so a
 * pattern cannot be widened to a different domain.
 *
 * Unset: every origin is allowed outside production (local dev on any port),
 * none in production.
 */
export function corsOriginMatcher(): (origin: string) => boolean {
  const raw = (process.env.CORS_ORIGINS ?? '').trim();

  if (!raw) {
    if (isProduction) {
      console.error('CORS_ORIGINS is not set: browsers on every origin will be refused. Set it to the client URL(s).');
      return () => false;
    }
    console.warn('CORS_ORIGINS is not set: allowing every origin (development only).');
    return () => true;
  }

  const patterns = raw
    .split(',')
    .map((s) => s.trim().replace(/\/+$/, '').toLowerCase())
    .filter(Boolean)
    .map((entry) => {
      const escaped = entry.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[a-z0-9-]+');
      return new RegExp(`^${escaped}$`);
    });

  return (origin) => patterns.some((p) => p.test(origin.toLowerCase()));
}

/**
 * Express `trust proxy` setting, from TRUST_PROXY.
 *
 * Behind a load balancer (Render) every request arrives from the proxy, and the
 * login rate limiter would lump every user into one bucket. Setting this to the
 * number of proxies in front of the app makes req.ip the real client again.
 * Too high lets a client spoof its IP with an X-Forwarded-For header, so it is
 * a number of hops, never `true`.
 */
export function trustProxy(): number | false {
  const raw = (process.env.TRUST_PROXY ?? '').trim();
  if (!raw || raw === 'false' || raw === '0') return false;
  const hops = Number(raw);
  if (!Number.isInteger(hops) || hops < 1 || hops > 5) {
    throw new Error(`TRUST_PROXY must be a number of proxy hops between 1 and 5 (got ${JSON.stringify(raw)})`);
  }
  return hops;
}
