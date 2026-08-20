import { Router, Request, Response } from 'express';
import { prisma } from '../prisma';
import analyticsRoutes from './analytics';
import authRoutes from './auth';
import bootstrapRoutes from './bootstrap';
import customerRoutes from './customers';
import productRoutes from './products';
import salesRoutes from './sales';
import shiftRoutes from './shifts';

const router = Router();

// Healthcheck Endpoint (GET /api/health)
router.get('/health', async (_req: Request, res: Response) => {
  try {
    // Ping PostgreSQL DB via Prisma
    await prisma.$queryRaw`SELECT 1`;
    res.json({
      status: 'ok',
      service: 'Sellkit POS API Server',
      database: 'connected',
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    res.status(500).json({
      status: 'error',
      service: 'Sellkit POS API Server',
      database: 'disconnected',
      error: error.message,
      timestamp: new Date().toISOString(),
    });
  }
});

// Sub-routes
router.use('/analytics', analyticsRoutes);
router.use('/auth', authRoutes);
router.use('/bootstrap', bootstrapRoutes);
router.use('/customers', customerRoutes);
router.use('/products', productRoutes);
router.use('/sales', salesRoutes);
router.use('/shifts', shiftRoutes);

export default router;
