import { Router } from 'express';
import { login, pinLogin, me, createUser } from '../controllers/auth';
import { authenticate, requireRole } from '../middleware/auth';
import { loginRateLimiter } from '../middleware/rateLimit';

const router = Router();

router.post('/login', loginRateLimiter, login);
router.post('/pin-login', loginRateLimiter, pinLogin);
router.get('/me', authenticate, me);
router.post('/users', authenticate, requireRole(['ADMIN', 'MANAGER']), createUser);

export default router;
