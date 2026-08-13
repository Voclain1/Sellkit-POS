import { Router } from 'express';
import { getCustomers, getCustomerById, createCustomer } from '../controllers/customers';
import { authenticate } from '../middleware/auth';

const router = Router();

router.use(authenticate);

router.get('/', getCustomers);
router.get('/:id', getCustomerById);
router.post('/', createCustomer);

export default router;
