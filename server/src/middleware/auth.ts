import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { Role } from '@prisma/client';
import { prisma } from '../prisma';
import { jwtSecret } from '../lib/env';

export interface AuthPayload {
  userId: string;
  email: string;
  role: Role;
  name: string;
  /** User.tokenVersion when the token was issued. Absent on pre-revocation tokens (= 0). */
  tv?: number;
}

export interface AuthenticatedRequest extends Request {
  user?: AuthPayload;
}

// Read once at startup: a missing or short secret stops the server booting
// rather than signing tokens with a value anyone can read in the source.
const JWT_SECRET = jwtSecret();

export const generateToken = (payload: AuthPayload): string => {
  return jwt.sign(payload, JWT_SECRET, { algorithm: 'HS256', expiresIn: '12h' });
};

/**
 * Whether a user may still act, cached briefly.
 *
 * A JWT is valid until it expires; without this, a sacked cashier's token kept
 * working for up to 12 hours. Checking the database on every request closes
 * that, and the short cache keeps it to one lookup per user per 30s -- the
 * database is a transatlantic round trip away from the API.
 */
interface UserAuthState {
  tokenVersion: number;
  disabled: boolean;
  role: Role;
  name: string;
  email: string;
}

const AUTH_STATE_TTL_MS = 30_000;
const authStateCache = new Map<string, { state: UserAuthState | null; expires: number }>();

async function userAuthState(userId: string): Promise<UserAuthState | null> {
  const now = Date.now();
  const hit = authStateCache.get(userId);
  if (hit && hit.expires > now) return hit.state;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { tokenVersion: true, disabledAt: true, role: true, name: true, email: true },
  });
  const state = user
    ? { tokenVersion: user.tokenVersion, disabled: user.disabledAt !== null, role: user.role, name: user.name, email: user.email }
    : null;

  authStateCache.set(userId, { state, expires: now + AUTH_STATE_TTL_MS });
  return state;
}

/** Drop a cached entry, so a change made by this process takes effect at once. */
export function forgetUserAuthState(userId: string): void {
  authStateCache.delete(userId);
}

export const authenticate = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Unauthorized: Missing or invalid token format' });
    return;
  }

  const token = authHeader.split(' ')[1];

  let decoded: AuthPayload;
  try {
    decoded = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] }) as AuthPayload;
  } catch {
    res.status(401).json({ error: 'Unauthorized: Token is expired or invalid' });
    return;
  }

  let state: UserAuthState | null;
  try {
    state = await userAuthState(decoded.userId);
  } catch (err) {
    // Database unreachable. Not the token's fault: 503 is retryable, so the
    // till's sync queue waits instead of treating the cashier as signed out.
    console.error('Auth state lookup failed:', err);
    res.status(503).json({ error: 'Service temporarily unavailable' });
    return;
  }

  if (!state || state.disabled || (decoded.tv ?? 0) !== state.tokenVersion) {
    res.status(401).json({ error: 'Unauthorized: Session has been revoked. Sign in again.' });
    return;
  }

  // Role and name from the database, not the token: a demotion takes effect
  // within the cache window instead of when the token expires.
  req.user = { ...decoded, role: state.role, name: state.name, email: state.email };
  next();
};

export const requireRole = (allowedRoles: Role[]) => {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized: User authentication required' });
      return;
    }

    if (!allowedRoles.includes(req.user.role)) {
      res.status(403).json({
        error: `Forbidden: Insufficient privileges. Required role: ${allowedRoles.join(', ')}`,
      });
      return;
    }

    next();
  };
};
