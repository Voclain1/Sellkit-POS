import { Router } from 'express';
import { openShift, closeShift, getCurrentShift, getShiftSummary } from '../controllers/shifts';
import { authenticate } from '../middleware/auth';

const router = Router();

router.use(authenticate);

router.post('/open', openShift);
router.post('/close', closeShift);
router.get('/current', getCurrentShift);
router.get('/:id/summary', getShiftSummary);

export default router;
