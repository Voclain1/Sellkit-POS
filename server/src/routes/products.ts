import { Router } from 'express';
import {
  getProducts,
  getProductById,
  createProduct,
  updateProduct,
  deleteProduct,
  searchProducts,
  getLowStockProducts,
} from '../controllers/products';
import { authenticate, requireRole } from '../middleware/auth';

const router = Router();

router.use(authenticate);

router.get('/search', searchProducts);
router.get('/low-stock', getLowStockProducts);
router.get('/', getProducts);
router.get('/:id', getProductById);
router.post('/', requireRole(['ADMIN', 'MANAGER']), createProduct);
router.put('/:id', requireRole(['ADMIN', 'MANAGER']), updateProduct);
router.delete('/:id', requireRole(['ADMIN', 'MANAGER']), deleteProduct);

export default router;
