import { Router } from 'express';
import { getBootstrap } from '../controllers/bootstrap';
import { authenticate } from '../middleware/auth';

const router = Router();

router.use(authenticate);

router.get('/', getBootstrap);

export default router;
