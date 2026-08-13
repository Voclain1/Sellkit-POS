import { Router } from 'express';
import { login, pinLogin, me, createUser } from '../controllers/auth';
import { authenticate, requireRole } from '../middleware/auth';

const router = Router();

router.post('/login', login);
router.post('/pin-login', pinLogin);
router.get('/me', authenticate, me);
router.post('/users', authenticate, requireRole(['ADMIN', 'MANAGER']), createUser);

export default router;
