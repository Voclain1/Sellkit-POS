import { Router } from 'express';
import { getDashboard } from '../controllers/analytics';
import { authenticate, requireRole } from '../middleware/auth';

const router = Router();

// Back-office only: trading figures are not cashier-facing.
router.use(authenticate, requireRole(['ADMIN', 'MANAGER']));

router.get('/dashboard', getDashboard);

export default router;
