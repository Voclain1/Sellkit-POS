import { Router } from 'express';
import { openShift, closeShift, getCurrentShift } from '../controllers/shifts';
import { authenticate } from '../middleware/auth';

const router = Router();

router.use(authenticate);

router.post('/open', openShift);
router.post('/close', closeShift);
router.get('/current', getCurrentShift);

export default router;
