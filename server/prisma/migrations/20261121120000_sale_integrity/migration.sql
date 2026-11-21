-- Sale integrity: replay protection, shift attribution, sequential receipts,
-- product archiving. See the sprint-1 bug list in the repository review.

-- User.pin is in schema.prisma but was never captured in a migration (it was
-- added with `db push`). IF NOT EXISTS makes this a no-op on databases that
-- already have it and repairs fresh ones built from migrations alone.
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "pin" TEXT;

-- Products with sales history are archived rather than deleted.
ALTER TABLE "Product" ADD COLUMN "archivedAt" TIMESTAMP(3);

-- Sale: idempotency key, review flag, shift link.
ALTER TABLE "Sale" ADD COLUMN "clientSaleId" TEXT,
ADD COLUMN "needsReview" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "reviewNotes" TEXT,
ADD COLUMN "shiftId" TEXT;

CREATE UNIQUE INDEX "Sale_clientSaleId_key" ON "Sale"("clientSaleId");
CREATE INDEX "Sale_shiftId_idx" ON "Sale"("shiftId");
CREATE INDEX "Sale_tillId_createdAt_idx" ON "Sale"("tillId", "createdAt");

ALTER TABLE "Sale" ADD CONSTRAINT "Sale_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "TillReconciliation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Till: receipt code + per-till counter. Existing tills get T01, T02, ... in
-- creation order before the column becomes required.
ALTER TABLE "Till" ADD COLUMN "code" TEXT,
ADD COLUMN "receiptSeq" INTEGER NOT NULL DEFAULT 0;

UPDATE "Till" t
SET "code" = 'T' || lpad(n.rn::text, 2, '0')
FROM (SELECT "id", row_number() OVER (ORDER BY "createdAt", "id") AS rn FROM "Till") n
WHERE t."id" = n."id";

ALTER TABLE "Till" ALTER COLUMN "code" SET NOT NULL;
CREATE UNIQUE INDEX "Till_code_key" ON "Till"("code");
