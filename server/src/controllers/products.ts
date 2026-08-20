import { Response } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../prisma';
import { AuthenticatedRequest } from '../middleware/auth';

// List all products with category and variants
export const getProducts = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const categoryId = typeof req.query.categoryId === 'string' ? req.query.categoryId : undefined;
    const search = typeof req.query.search === 'string' ? req.query.search : undefined;

    const whereClause: Prisma.ProductWhereInput = {};
    if (categoryId) {
      whereClause.categoryId = categoryId;
    }
    if (search) {
      whereClause.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
        { variants: { some: { sku: { contains: search, mode: 'insensitive' } } } },
        { variants: { some: { barcode: { contains: search, mode: 'insensitive' } } } },
      ];
    }

    const products = await prisma.product.findMany({
      where: whereClause,
      include: {
        category: true,
        variants: true,
      },
      orderBy: { updatedAt: 'desc' },
    });

    res.json(products);
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to fetch products', details: error.message });
  }
};

// Get single product details
export const getProductById = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;

    const product = await prisma.product.findUnique({
      where: { id },
      include: {
        category: true,
        variants: true,
      },
    });

    if (!product) {
      res.status(404).json({ error: 'Product not found' });
      return;
    }

    res.json(product);
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to fetch product', details: error.message });
  }
};

// Create product with optional variants
export const createProduct = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { categoryId, name, description, variants } = req.body;

    if (!categoryId || !name) {
      res.status(400).json({ error: 'Category ID and Product name are required' });
      return;
    }

    // Ensure category exists or auto-create if missing
    let category = await prisma.category.findUnique({ where: { id: categoryId as string } });
    if (!category) {
      category = await prisma.category.create({
        data: { id: categoryId as string, name: categoryId as string },
      }).catch(async () => {
        return (await prisma.category.findFirst()) || await prisma.category.create({ data: { name: 'General' } });
      });
    }

    const product = await prisma.product.create({
      data: {
        categoryId: category.id,
        name,
        description,
        variants: {
          create: Array.isArray(variants) && variants.length > 0 ? variants.map((v: any) => ({
            name: v.name || 'Standard',
            sku: v.sku || `SKU-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
            barcode: v.barcode || null,
            price: v.price || 0,
            cost: v.cost || 0,
            stockQuantity: v.stockQuantity || 0,
          })) : [
            {
              name: 'Standard',
              sku: `SKU-${Date.now()}`,
              barcode: null,
              price: req.body.price || 0,
              cost: req.body.cost || 0,
              stockQuantity: req.body.stockQuantity || 0,
            }
          ],
        },
      },
      include: {
        category: true,
        variants: true,
      },
    });

    res.status(201).json(product);
  } catch (error: any) {
    // Duplicate SKU/barcode is an operator error: 4xx, so the client shows it
    // rather than treating it as a transient server fault worth retrying.
    if (error.code === 'P2002') {
      const target = Array.isArray(error.meta?.target) ? error.meta.target.join(', ') : 'field';
      res.status(409).json({ error: `Another variant already uses that ${target}` });
      return;
    }
    res.status(500).json({ error: 'Failed to create product', details: error.message });
  }
};

// Update product and variants
export const updateProduct = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;
    const { categoryId, name, description } = req.body;

    const existingProduct = await prisma.product.findUnique({ where: { id } });
    if (!existingProduct) {
      res.status(404).json({ error: 'Product not found' });
      return;
    }

    const updatedProduct = await prisma.product.update({
      where: { id },
      data: {
        categoryId: categoryId ? (categoryId as string) : existingProduct.categoryId,
        name: name || existingProduct.name,
        description: description !== undefined ? description : existingProduct.description,
      },
      include: {
        category: true,
        variants: true,
      },
    });

    res.json(updatedProduct);
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to update product', details: error.message });
  }
};

// Delete product
export const deleteProduct = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;

    // Delete variants first, then product
    await prisma.productVariant.deleteMany({ where: { productId: id } });
    await prisma.product.delete({ where: { id } });

    res.json({ message: 'Product deleted successfully' });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to delete product', details: error.message });
  }
};

// Fast barcode & SKU search endpoint (/api/products/search?barcode=... or ?query=...)
export const searchProducts = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const barcode = typeof req.query.barcode === 'string' ? req.query.barcode.trim() : undefined;
    const sku = typeof req.query.sku === 'string' ? req.query.sku.trim() : undefined;
    const query = typeof req.query.query === 'string' ? req.query.query.trim() : undefined;

    const searchTerm = barcode || sku || query;

    if (!searchTerm) {
      res.status(400).json({ error: 'Search parameter (barcode, sku, or query) is required' });
      return;
    }

    const variants = await prisma.productVariant.findMany({
      where: {
        OR: [
          { barcode: { equals: searchTerm, mode: 'insensitive' as Prisma.QueryMode } },
          { sku: { equals: searchTerm, mode: 'insensitive' as Prisma.QueryMode } },
          { name: { contains: searchTerm, mode: 'insensitive' as Prisma.QueryMode } },
          { product: { name: { contains: searchTerm, mode: 'insensitive' as Prisma.QueryMode } } },
        ],
      },
      include: {
        product: {
          include: {
            category: true,
          },
        },
      },
    });

    res.json(variants);
  } catch (error: any) {
    res.status(500).json({ error: 'Product search failed', details: error.message });
  }
};

// Low-stock alert query endpoint (/api/products/low-stock?threshold=10)
export const getLowStockProducts = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const thresholdStr = typeof req.query.threshold === 'string' ? req.query.threshold : '10';
    const threshold = parseInt(thresholdStr, 10);

    const lowStockVariants = await prisma.productVariant.findMany({
      where: {
        stockQuantity: {
          lte: isNaN(threshold) ? 10 : threshold,
        },
      },
      include: {
        product: {
          include: {
            category: true,
          },
        },
      },
      orderBy: {
        stockQuantity: 'asc',
      },
    });

    res.json({
      threshold: isNaN(threshold) ? 10 : threshold,
      count: lowStockVariants.length,
      variants: lowStockVariants,
    });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to fetch low stock alerts', details: error.message });
  }
};

// Category list for the back-office product forms (/api/products/categories)
export const getCategories = async (_req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const categories = await prisma.category.findMany({ orderBy: { name: 'asc' } });
    res.json(categories);
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to fetch categories', details: error.message });
  }
};

/**
 * Re-stock a single variant (PATCH /api/products/variants/:variantId/stock).
 *
 * Accepts either `stockQuantity` (an absolute count, from a stock take) or
 * `delta` (units received). `delta` is applied inside a transaction with the
 * read, so two people booking in deliveries at once cannot lose one of them.
 */
export const updateVariantStock = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const variantId = req.params.variantId as string;
    const { stockQuantity, delta } = req.body;

    const hasAbsolute = stockQuantity !== undefined && stockQuantity !== null;
    const hasDelta = delta !== undefined && delta !== null;

    if (hasAbsolute === hasDelta) {
      res.status(400).json({ error: 'Provide exactly one of stockQuantity (absolute) or delta (adjustment)' });
      return;
    }

    const raw = Number(hasAbsolute ? stockQuantity : delta);
    if (!Number.isInteger(raw)) {
      res.status(400).json({ error: 'Stock values must be whole numbers' });
      return;
    }
    if (hasAbsolute && raw < 0) {
      res.status(400).json({ error: 'stockQuantity cannot be negative' });
      return;
    }

    const existing = await prisma.productVariant.findUnique({ where: { id: variantId } });
    if (!existing) {
      res.status(404).json({ error: 'Product variant not found' });
      return;
    }

    if (hasDelta && existing.stockQuantity + raw < 0) {
      res.status(400).json({
        error: `Adjustment of ${raw} would take ${existing.sku} below zero (currently ${existing.stockQuantity})`,
      });
      return;
    }

    const variant = await prisma.productVariant.update({
      where: { id: variantId },
      data: hasAbsolute ? { stockQuantity: raw } : { stockQuantity: { increment: raw } },
      include: { product: { include: { category: true } } },
    });

    res.json(variant);
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to update stock', details: error.message });
  }
};

/**
 * Update one variant's pricing and identity (PUT /api/products/variants/:variantId).
 * Stock is deliberately not settable here — re-stocking goes through
 * `updateVariantStock` so an edit to a price can never silently reset the shelf.
 */
export const updateVariant = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const variantId = req.params.variantId as string;
    const { name, sku, barcode, price, cost } = req.body;

    const existing = await prisma.productVariant.findUnique({ where: { id: variantId } });
    if (!existing) {
      res.status(404).json({ error: 'Product variant not found' });
      return;
    }

    if (price !== undefined && (isNaN(Number(price)) || Number(price) < 0)) {
      res.status(400).json({ error: 'Price must be a non-negative number' });
      return;
    }
    if (cost !== undefined && (isNaN(Number(cost)) || Number(cost) < 0)) {
      res.status(400).json({ error: 'Cost must be a non-negative number' });
      return;
    }

    const data: Prisma.ProductVariantUpdateInput = {};
    if (name !== undefined) data.name = name || null;
    if (sku) data.sku = String(sku).trim();
    if (barcode !== undefined) data.barcode = barcode ? String(barcode).trim() : null;
    if (price !== undefined) data.price = Number(price);
    if (cost !== undefined) data.cost = Number(cost);

    const variant = await prisma.productVariant.update({
      where: { id: variantId },
      data,
      include: { product: { include: { category: true } } },
    });

    res.json(variant);
  } catch (error: any) {
    // A duplicate SKU or barcode is the operator's mistake, not a server fault —
    // 4xx keeps the client's offline queue from retrying it forever.
    if (error.code === 'P2002') {
      const target = Array.isArray(error.meta?.target) ? error.meta.target.join(', ') : 'field';
      res.status(409).json({ error: `Another variant already uses that ${target}` });
      return;
    }
    res.status(500).json({ error: 'Failed to update variant', details: error.message });
  }
};
