import { Response } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../prisma';
import { AuthenticatedRequest } from '../middleware/auth';

/**
 * GET /api/customers?search=&take=
 *
 * Backs the "attach customer" picker at the till, so search has to tolerate a
 * cashier typing a partial name or reading a phone number off a loyalty card.
 */
export const getCustomers = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
    const takeRaw = typeof req.query.take === 'string' ? parseInt(req.query.take, 10) : NaN;
    const take = Number.isFinite(takeRaw) ? Math.min(Math.max(takeRaw, 1), 100) : 25;

    const where: Prisma.CustomerWhereInput = search
      ? {
          OR: [
            { name: { contains: search, mode: 'insensitive' } },
            { phone: { contains: search, mode: 'insensitive' } },
            { email: { contains: search, mode: 'insensitive' } },
          ],
        }
      : {};

    const customers = await prisma.customer.findMany({
      where,
      orderBy: [{ loyaltyPoints: 'desc' }, { name: 'asc' }],
      take,
    });

    res.json(customers);
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to fetch customers', details: error.message });
  }
};

// Get a single customer, including recent purchase history.
export const getCustomerById = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;

    const customer = await prisma.customer.findUnique({
      where: { id },
      include: {
        sales: {
          orderBy: { createdAt: 'desc' },
          take: 10,
          include: { paymentSplits: true },
        },
      },
    });

    if (!customer) {
      res.status(404).json({ error: 'Customer not found' });
      return;
    }

    res.json(customer);
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to fetch customer', details: error.message });
  }
};

// Create a customer from the till (cashiers enrol walk-ins at checkout).
export const createCustomer = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { name, phone, email } = req.body;

    if (!name || !String(name).trim()) {
      res.status(400).json({ error: 'Customer name is required' });
      return;
    }

    const normalisedPhone = phone ? String(phone).trim() : null;
    const normalisedEmail = email ? String(email).toLowerCase().trim() : null;

    // phone and email are unique; report the clash rather than a raw Prisma error.
    if (normalisedPhone || normalisedEmail) {
      const clash = await prisma.customer.findFirst({
        where: {
          OR: [
            ...(normalisedPhone ? [{ phone: normalisedPhone }] : []),
            ...(normalisedEmail ? [{ email: normalisedEmail }] : []),
          ],
        },
      });

      if (clash) {
        res.status(409).json({ error: 'A customer with that phone or email already exists', customer: clash });
        return;
      }
    }

    const customer = await prisma.customer.create({
      data: {
        name: String(name).trim(),
        phone: normalisedPhone,
        email: normalisedEmail,
      },
    });

    res.status(201).json(customer);
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to create customer', details: error.message });
  }
};
