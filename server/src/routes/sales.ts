import { Router } from 'express';
import { processCheckout, getSales, getSaleById } from '../controllers/sales';
import { authenticate } from '../middleware/auth';

const router = Router();

router.use(authenticate);

router.post('/checkout', processCheckout);
router.get('/', getSales);
router.get('/:id', getSaleById);

export default router;
