/**
 * Deterministic IDs for seeded records.
 *
 * Fixed UUIDs let tests, the seed script, and /api/bootstrap agree on which rows
 * are "the primary outlet" and "the default till" without matching on names or
 * guessing at insertion order. Every id column is TEXT, so these are plain
 * strings -- no migration is involved.
 *
 * Real records created through the API keep using random UUIDs.
 */
export const DEFAULT_IDS = {
  outlet: '00000000-0000-4000-8000-000000000001',
  till: '00000000-0000-4000-8000-000000000002',
  category: '00000000-0000-4000-8000-000000000003',
  adminUser: '00000000-0000-4000-8000-000000000010',
  cashierUser: '00000000-0000-4000-8000-000000000011',
  customer: '00000000-0000-4000-8000-000000000020',
  products: [
    '00000000-0000-4000-8000-000000000030',
    '00000000-0000-4000-8000-000000000031',
    '00000000-0000-4000-8000-000000000032',
  ],
  variants: [
    '00000000-0000-4000-8000-000000000040',
    '00000000-0000-4000-8000-000000000041',
    '00000000-0000-4000-8000-000000000042',
  ],
} as const;
