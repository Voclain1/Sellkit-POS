-- Token revocation and account disabling. Additive: existing tokens carry no
-- version and are treated as version 0, which matches the default, so nobody
-- is signed out by this migration.
ALTER TABLE "User" ADD COLUMN "tokenVersion" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "disabledAt" TIMESTAMP(3);
