import { Response } from 'express';
import bcrypt from 'bcryptjs';
import { Role, User } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../prisma';
import { AuthenticatedRequest, generateToken } from '../middleware/auth';
import { hashPin, isLegacyPin, pinLookupPrefix, verifyPin } from '../lib/pin';
import { HttpError } from '../lib/httpError';
import { handleError } from '../lib/respond';
import { parseBody, pinSchema } from '../lib/validate';

// ---------------------------------------------------------------------------
// Per-account lockout
// ---------------------------------------------------------------------------

/**
 * Failed attempts against one named account before it is locked for a while.
 *
 * The per-IP limiter (middleware/rateLimit.ts) stops one client hammering the
 * endpoint; this stops a distributed guess at one known account. Kept in
 * memory: the API runs as a single instance, and a restart clearing a lock is
 * an acceptable failure mode for a 15-minute lockout.
 */
const ACCOUNT_MAX_FAILURES = 5;
const ACCOUNT_LOCK_MS = 15 * 60 * 1000;
const accountFailures = new Map<string, { count: number; lockedUntil: number }>();

function assertNotLocked(key: string): void {
  const entry = accountFailures.get(key);
  if (entry && entry.lockedUntil > Date.now()) {
    const minutes = Math.ceil((entry.lockedUntil - Date.now()) / 60000);
    throw new HttpError(429, `Too many failed attempts for this account. Try again in ${minutes} minutes.`);
  }
}

function recordFailure(key: string): void {
  const entry = accountFailures.get(key) ?? { count: 0, lockedUntil: 0 };
  if (entry.lockedUntil && entry.lockedUntil <= Date.now()) entry.count = 0;
  entry.count += 1;
  if (entry.count >= ACCOUNT_MAX_FAILURES) entry.lockedUntil = Date.now() + ACCOUNT_LOCK_MS;
  accountFailures.set(key, entry);
}

function recordSuccess(key: string): void {
  accountFailures.delete(key);
}

/** Compared against when the email is unknown, so timing does not reveal which emails exist. */
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 10);

const INVALID_CREDENTIALS = 'Invalid credentials';

function issueSession(res: Response, user: User): void {
  const token = generateToken({
    userId: user.id,
    email: user.email,
    role: user.role,
    name: user.name,
    tv: user.tokenVersion,
  });

  res.json({
    token,
    user: { id: user.id, email: user.email, name: user.name, role: user.role },
  });
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email('Enter a valid email'),
  password: z.string().min(1, 'Password is required').max(200),
});

export const login = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { email, password } = parseBody(loginSchema, req.body);
    const lockKey = `email:${email}`;
    assertNotLocked(lockKey);

    const user = await prisma.user.findUnique({ where: { email } });
    const isMatch = await bcrypt.compare(password, user?.password ?? DUMMY_HASH);

    if (!user || !isMatch || user.disabledAt) {
      recordFailure(lockKey);
      res.status(401).json({ error: INVALID_CREDENTIALS });
      return;
    }

    recordSuccess(lockKey);
    issueSession(res, user);
  } catch (error) {
    handleError(res, error, 'Login failed');
  }
};

const pinLoginSchema = z.object({
  pin: pinSchema,
  userId: z.string().trim().min(1).max(100).optional(),
  email: z.string().trim().toLowerCase().email().optional(),
});

export const pinLogin = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { pin, userId, email } = parseBody(pinLoginSchema, req.body);

    let user: User | null = null;

    if (userId || email) {
      // Fast path: the terminal already knows who is logging in, so this is a single
      // indexed lookup plus exactly one bcrypt compare.
      const lockKey = userId ? `user:${userId}` : `email:${email}`;
      assertNotLocked(lockKey);

      const candidate = userId
        ? await prisma.user.findUnique({ where: { id: userId } })
        : await prisma.user.findUnique({ where: { email } });

      if (candidate && !candidate.disabledAt && (await verifyPin(pin, candidate.pin))) {
        user = candidate;
        recordSuccess(lockKey);
      } else {
        recordFailure(lockKey);
      }
    } else {
      // PIN-only login: resolve the user with one query on the deterministic lookup
      // hash. No bcrypt work happens for non-matching users. Brute force here is
      // held back by the per-IP limiter on this route.
      const matches = await prisma.user.findMany({
        where: { pin: { startsWith: pinLookupPrefix(pin) }, disabledAt: null },
        take: 2,
      });

      if (matches.length > 1) {
        // Two staff members share this PIN; the terminal must say which one it is.
        res.status(409).json({
          error: 'This PIN matches more than one user. Select your account and try again.',
          requiresUserSelection: true,
        });
        return;
      }

      const candidate = matches[0] ?? null;
      if (candidate && (await verifyPin(pin, candidate.pin))) {
        user = candidate;
      }
    }

    if (!user) {
      res.status(401).json({ error: 'Invalid PIN or user not found' });
      return;
    }

    // Transparently upgrade a pre-v2 (bare bcrypt) PIN now that we have the plaintext,
    // so this user is reachable by PIN-only login next time.
    if (user.pin && isLegacyPin(user.pin)) {
      const upgraded = await hashPin(pin);
      await prisma.user
        .update({ where: { id: user.id }, data: { pin: upgraded } })
        .catch((err: unknown) => console.warn('PIN format upgrade failed:', err));
    }

    issueSession(res, user);
  } catch (error) {
    handleError(res, error, 'PIN login failed');
  }
};

export const me = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const user = await prisma.user.findUnique({
      where: { id: req.user.userId },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        pin: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    res.json({
      ...user,
      hasPinSet: Boolean(user.pin),
      pin: undefined,
    });
  } catch (error) {
    handleError(res, error, 'Failed to fetch user profile');
  }
};

/**
 * Who may create which role. A manager could previously create an ADMIN --
 * and so promote themselves -- because the requested role was never checked.
 */
const CREATABLE_ROLES: Record<Role, Role[]> = {
  ADMIN: ['ADMIN', 'MANAGER', 'CASHIER'],
  MANAGER: ['CASHIER'],
  CASHIER: [],
};

const createUserSchema = z.object({
  email: z.string().trim().toLowerCase().email('Enter a valid email'),
  password: z.string().min(8, 'Password must be at least 8 characters').max(200),
  name: z.string().trim().min(1, 'Name is required').max(100),
  role: z.nativeEnum(Role).default('CASHIER'),
  pin: pinSchema.optional(),
});

export const createUser = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { email, password, name, role, pin } = parseBody(createUserSchema, req.body);

    const callerRole = req.user?.role ?? 'CASHIER';
    if (!CREATABLE_ROLES[callerRole].includes(role)) {
      throw new HttpError(403, `A ${callerRole} cannot create ${role} accounts`);
    }

    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      throw new HttpError(409, 'User with this email already exists');
    }

    // PIN-only login finds a user by PIN alone; a shared PIN makes both users
    // ambiguous at the keypad.
    if (pin) {
      const clash = await prisma.user.findFirst({
        where: { pin: { startsWith: pinLookupPrefix(pin) } },
        select: { id: true },
      });
      if (clash) throw new HttpError(409, 'That PIN is already in use. Choose another.');
    }

    const newUser = await prisma.user.create({
      data: {
        email,
        password: await bcrypt.hash(password, 10),
        name,
        role,
        pin: pin ? await hashPin(pin) : undefined,
      },
      select: { id: true, email: true, name: true, role: true, createdAt: true },
    });

    res.status(201).json(newUser);
  } catch (error) {
    handleError(res, error, 'Failed to create user');
  }
};
