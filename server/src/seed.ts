import bcrypt from 'bcryptjs';
import { prisma } from './prisma';
import { DEFAULT_IDS } from './lib/defaults';
import { hashPin } from './lib/pin';

/**
 * Seeds the deterministic development dataset.
 *
 * Every record is upserted by its fixed id from DEFAULT_IDS, so the script is
 * idempotent and /api/bootstrap, the tests, and this file all agree on which
 * outlet and till are "the default" ones.
 */
const SEEDED_EMAILS = ['admin@sellkitpos.com', 'cashier@sellkitpos.com'];
const SEEDED_SKUS = ['SKU-MOUSE-001', 'SKU-KB-002', 'SKU-CABLE-003'];

/**
 * Earlier seed runs created these records with random UUIDs. Their natural keys
 * (User.email, Customer.phone/email, ProductVariant.sku/barcode) are unique, so
 * they would collide with the deterministic rows below.
 *
 * Rows that nothing references are removed. Rows with sales attached are left
 * alone and the seed stops, rather than deleting transaction history to make a
 * dev fixture fit.
 */
async function retireLegacyDuplicates(): Promise<void> {
  const blockers: string[] = [];

  const legacyUsers = await prisma.user.findMany({
    where: {
      email: { in: SEEDED_EMAILS },
      id: { notIn: [DEFAULT_IDS.adminUser, DEFAULT_IDS.cashierUser] },
    },
    include: { _count: { select: { sales: true, tillReconciliations: true } } },
  });

  for (const user of legacyUsers) {
    if (user._count.sales > 0 || user._count.tillReconciliations > 0) {
      blockers.push(
        `User ${user.email} (${user.id}) has ${user._count.sales} sale(s) and ${user._count.tillReconciliations} shift(s)`
      );
      continue;
    }
    await prisma.user.delete({ where: { id: user.id } });
    console.log(`🧹 Removed legacy user ${user.email} (${user.id})`);
  }

  const legacyCustomers = await prisma.customer.findMany({
    where: {
      OR: [{ phone: '+1555123456' }, { email: 'jane.doe@example.com' }],
      id: { not: DEFAULT_IDS.customer },
    },
    include: { _count: { select: { sales: true } } },
  });

  for (const customer of legacyCustomers) {
    if (customer._count.sales > 0) {
      blockers.push(`Customer ${customer.name} (${customer.id}) has ${customer._count.sales} sale(s)`);
      continue;
    }
    await prisma.customer.delete({ where: { id: customer.id } });
    console.log(`🧹 Removed legacy customer ${customer.name} (${customer.id})`);
  }

  const legacyVariants = await prisma.productVariant.findMany({
    where: { sku: { in: SEEDED_SKUS }, id: { notIn: [...DEFAULT_IDS.variants] } },
    include: { _count: { select: { saleItems: true } } },
  });

  for (const variant of legacyVariants) {
    if (variant._count.saleItems > 0) {
      blockers.push(`Variant ${variant.sku} (${variant.id}) appears on ${variant._count.saleItems} sale line(s)`);
      continue;
    }
    await prisma.productVariant.delete({ where: { id: variant.id } });
    console.log(`🧹 Removed legacy variant ${variant.sku} (${variant.id})`);
  }

  // Products left with no variants after the sweep are dead weight.
  const orphanProducts = await prisma.product.findMany({
    where: { id: { notIn: [...DEFAULT_IDS.products] } },
    include: { _count: { select: { variants: true } } },
  });

  for (const product of orphanProducts) {
    if (product._count.variants > 0) continue;
    await prisma.product.delete({ where: { id: product.id } });
    console.log(`🧹 Removed orphaned product "${product.name}" (${product.id})`);
  }

  if (blockers.length > 0) {
    throw new Error(
      'Cannot apply deterministic seed IDs — these records have transaction history:\n  - ' +
        blockers.join('\n  - ') +
        '\nResolve them manually (or reset the database) before re-seeding.'
    );
  }
}

async function seed() {
  console.log('🌱 Seeding database...');

  await retireLegacyDuplicates();

  // 1. Admin user, with a PIN (4321) so the back office is reachable from the
  // terminal. The keypad is the only sign-in path in the client, so an admin
  // without a PIN cannot log in at all.
  const adminPassword = await bcrypt.hash('admin123', 10);
  const adminPin = await hashPin('4321');
  const adminUser = await prisma.user.upsert({
    where: { id: DEFAULT_IDS.adminUser },
    // `update` repairs an existing admin row rather than needing a fresh database.
    update: { email: 'admin@sellkitpos.com', name: 'System Admin', role: 'ADMIN', pin: adminPin },
    create: {
      id: DEFAULT_IDS.adminUser,
      email: 'admin@sellkitpos.com',
      name: 'System Admin',
      password: adminPassword,
      pin: adminPin,
      role: 'ADMIN',
    },
  });
  console.log('✅ Admin User:', adminUser.email, '(PIN: 4321)');

  // 2. Cashier with a 4-digit PIN (1234), stored in the v2 lookup+bcrypt format.
  const cashierPassword = await bcrypt.hash('cashier123', 10);
  const cashierPin = await hashPin('1234');
  const cashierUser = await prisma.user.upsert({
    where: { id: DEFAULT_IDS.cashierUser },
    update: { email: 'cashier@sellkitpos.com', name: 'John Cashier', role: 'CASHIER', pin: cashierPin },
    create: {
      id: DEFAULT_IDS.cashierUser,
      email: 'cashier@sellkitpos.com',
      name: 'John Cashier',
      password: cashierPassword,
      pin: cashierPin,
      role: 'CASHIER',
    },
  });
  console.log('✅ Cashier User:', cashierUser.email, '(PIN: 1234)');

  // 3. Primary outlet & till
  const outlet = await prisma.outlet.upsert({
    where: { id: DEFAULT_IDS.outlet },
    update: {},
    create: {
      id: DEFAULT_IDS.outlet,
      name: 'Main Store',
      address: '123 Retail Ave, Commercial District',
      phone: '+1 800-555-SELL',
    },
  });
  console.log('✅ Outlet:', outlet.name, `(${outlet.id})`);

  const till = await prisma.till.upsert({
    where: { id: DEFAULT_IDS.till },
    update: { outletId: outlet.id },
    create: { id: DEFAULT_IDS.till, name: 'Register #1', outletId: outlet.id },
  });
  console.log('✅ Till:', till.name, `(${till.id})`);

  // 4. Category & products
  const category = await prisma.category.upsert({
    where: { id: DEFAULT_IDS.category },
    update: {},
    create: {
      id: DEFAULT_IDS.category,
      name: 'Electronics',
      description: 'Gadgets and electronic accessories',
    },
  });

  const sampleProducts = [
    {
      id: DEFAULT_IDS.products[0],
      variantId: DEFAULT_IDS.variants[0],
      name: 'Wireless Ergonomic Mouse',
      description: '2.4GHz High Precision Optical Mouse',
      sku: 'SKU-MOUSE-001',
      barcode: '8901234567890',
      price: 29.99,
      cost: 15.0,
      stockQuantity: 45,
    },
    {
      id: DEFAULT_IDS.products[1],
      variantId: DEFAULT_IDS.variants[1],
      name: 'Mechanical Gaming Keyboard',
      description: 'RGB Backlit Blue Switch Mechanical Keyboard',
      sku: 'SKU-KB-002',
      barcode: '8901234567891',
      price: 79.99,
      cost: 40.0,
      stockQuantity: 5, // Low stock, exercises the alert styling
    },
    {
      id: DEFAULT_IDS.products[2],
      variantId: DEFAULT_IDS.variants[2],
      name: 'USB-C Fast Charging Cable (2m)',
      description: 'Braided Nylon 60W USB-C to USB-C Cable',
      sku: 'SKU-CABLE-003',
      barcode: '8901234567892',
      price: 12.5,
      cost: 4.0,
      stockQuantity: 120,
    },
  ];

  for (const p of sampleProducts) {
    await prisma.product.upsert({
      where: { id: p.id },
      update: { name: p.name, description: p.description, categoryId: category.id },
      create: {
        id: p.id,
        categoryId: category.id,
        name: p.name,
        description: p.description,
      },
    });

    // Stock is reset on every seed so repeated runs give a predictable starting point.
    await prisma.productVariant.upsert({
      where: { id: p.variantId },
      update: {
        price: p.price,
        cost: p.cost,
        stockQuantity: p.stockQuantity,
        sku: p.sku,
        barcode: p.barcode,
      },
      create: {
        id: p.variantId,
        productId: p.id,
        name: 'Standard',
        sku: p.sku,
        barcode: p.barcode,
        price: p.price,
        cost: p.cost,
        stockQuantity: p.stockQuantity,
      },
    });
  }
  console.log('✅ Sample Products seeded:', sampleProducts.length);

  // 5. Sample customers
  const customer = await prisma.customer.upsert({
    where: { id: DEFAULT_IDS.customer },
    update: {},
    create: {
      id: DEFAULT_IDS.customer,
      name: 'Jane Doe',
      email: 'jane.doe@example.com',
      phone: '+1555123456',
      loyaltyPoints: 50,
    },
  });
  console.log('✅ Sample Customer:', customer.name);

  // 6. Retire pre-deterministic duplicates left by earlier seed runs.
  // Only rows with no sales attached are removed, so nothing referenced is deleted.
  const legacyOutlets = await prisma.outlet.findMany({
    where: { id: { not: DEFAULT_IDS.outlet } },
    include: { _count: { select: { sales: true, tills: true } } },
  });

  for (const legacy of legacyOutlets) {
    if (legacy._count.sales > 0) {
      console.log(`⏭️  Kept outlet "${legacy.name}" (${legacy.id}) — it has sales attached`);
      continue;
    }

    const tills = await prisma.till.findMany({
      where: { outletId: legacy.id },
      include: { _count: { select: { sales: true, tillReconciliations: true } } },
    });

    const tillsInUse = tills.filter(
      (t) => t._count.sales > 0 || t._count.tillReconciliations > 0
    );
    if (tillsInUse.length > 0) {
      console.log(`⏭️  Kept outlet "${legacy.name}" (${legacy.id}) — its tills are in use`);
      continue;
    }

    await prisma.till.deleteMany({ where: { outletId: legacy.id } });
    await prisma.outlet.delete({ where: { id: legacy.id } });
    console.log(`🧹 Removed unused legacy outlet "${legacy.name}" (${legacy.id})`);
  }

  console.log('\n🎉 Seeding finished successfully!');
  console.log(`   Outlet ID: ${outlet.id}`);
  console.log(`   Till ID:   ${till.id}`);
}

seed()
  .catch((e) => {
    console.error('❌ Seeding failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
