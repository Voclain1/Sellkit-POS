import { Response } from 'express';
import bcrypt from 'bcryptjs';
import { User } from '@prisma/client';
import { prisma } from '../prisma';
import { AuthenticatedRequest, generateToken } from '../middleware/auth';
import { hashPin, isLegacyPin, pinLookupPrefix, verifyPin } from '../lib/pin';

export const login = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      res.status(400).json({ error: 'Email and password are required' });
      return;
    }

    const user = await prisma.user.findUnique({
      where: { email: email.toLowerCase().trim() },
    });

    if (!user) {
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }

    const payload = {
      userId: user.id,
      email: user.email,
      role: user.role,
      name: user.name,
    };

    const token = generateToken(payload);

    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
      },
    });
  } catch (error: any) {
    res.status(500).json({ error: 'Login failed', details: error.message });
  }
};

export const pinLogin = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { pin, userId, email } = req.body;

    if (!pin) {
      res.status(400).json({ error: 'PIN is required' });
      return;
    }

    let user: User | null = null;

    if (userId || email) {
      // Fast path: the terminal already knows who is logging in, so this is a single
      // indexed lookup plus exactly one bcrypt compare.
      const candidate = userId
        ? await prisma.user.findUnique({ where: { id: String(userId) } })
        : await prisma.user.findUnique({ where: { email: String(email).toLowerCase().trim() } });

      if (candidate && (await verifyPin(pin, candidate.pin))) {
        user = candidate;
      }
    } else {
      // PIN-only login: resolve the user with one query on the deterministic lookup
      // hash. No bcrypt work happens for non-matching users.
      const matches = await prisma.user.findMany({
        where: { pin: { startsWith: pinLookupPrefix(pin) } },
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

    const payload = {
      userId: user.id,
      email: user.email,
      role: user.role,
      name: user.name,
    };

    const token = generateToken(payload);

    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
      },
    });
  } catch (error: any) {
    res.status(500).json({ error: 'PIN login failed', details: error.message });
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
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to fetch user profile', details: error.message });
  }
};

export const createUser = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { email, password, name, role, pin } = req.body;

    if (!email || !password || !name) {
      res.status(400).json({ error: 'Email, password, and name are required' });
      return;
    }

    const existingUser = await prisma.user.findUnique({
      where: { email: email.toLowerCase().trim() },
    });

    if (existingUser) {
      res.status(400).json({ error: 'User with this email already exists' });
      return;
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const hashedPin = pin ? await hashPin(pin) : undefined;

    const newUser = await prisma.user.create({
      data: {
        email: email.toLowerCase().trim(),
        password: hashedPassword,
        name,
        role: role || 'CASHIER',
        pin: hashedPin,
      },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        createdAt: true,
      },
    });

    res.status(201).json(newUser);
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to create user', details: error.message });
  }
};
