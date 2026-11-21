import { Router } from 'express';
import { processCheckout, getSales, getSaleById } from '../controllers/sales';
import { authenticate, requireRole } from '../middleware/auth';

const router = Router();

router.use(authenticate);

router.post('/checkout', processCheckout);
// The full sales ledger is back-office data; a cashier sees only their own
// receipts, through GET /:id.
router.get('/', requireRole(['ADMIN', 'MANAGER']), getSales);
router.get('/:id', getSaleById);

export default router;
