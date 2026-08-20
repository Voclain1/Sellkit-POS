import { Router } from 'express';
import {
  getProducts,
  getProductById,
  createProduct,
  updateProduct,
  deleteProduct,
  searchProducts,
  getLowStockProducts,
  getCategories,
  updateVariant,
  updateVariantStock,
} from '../controllers/products';
import { authenticate, requireRole } from '../middleware/auth';

const router = Router();

router.use(authenticate);

// Literal segments must be declared before '/:id' or they are swallowed by it.
router.get('/categories', getCategories);
router.get('/search', searchProducts);
router.get('/low-stock', getLowStockProducts);
router.get('/', getProducts);

// Variant-level back-office edits. Stock has its own route so a price change
// can never carry an unintended stock write with it.
router.patch('/variants/:variantId/stock', requireRole(['ADMIN', 'MANAGER']), updateVariantStock);
router.put('/variants/:variantId', requireRole(['ADMIN', 'MANAGER']), updateVariant);

router.get('/:id', getProductById);
router.post('/', requireRole(['ADMIN', 'MANAGER']), createProduct);
router.put('/:id', requireRole(['ADMIN', 'MANAGER']), updateProduct);
router.delete('/:id', requireRole(['ADMIN', 'MANAGER']), deleteProduct);

export default router;
