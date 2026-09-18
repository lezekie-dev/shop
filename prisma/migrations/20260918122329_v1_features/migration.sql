-- CreateEnum
CREATE TYPE "PromoKind" AS ENUM ('PERCENT', 'FIXED');

-- CreateEnum
CREATE TYPE "ReviewStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('RUNNING', 'SUCCEEDED', 'FAILED');

-- AlterEnum
ALTER TYPE "Role" ADD VALUE 'STAFF';

-- DropIndex
DROP INDEX "LoginAttempt_identifier_createdAt_idx";

-- AlterTable
ALTER TABLE "Address" ADD COLUMN     "label" TEXT,
ADD COLUMN     "phone" TEXT;

-- AlterTable
ALTER TABLE "Cart" ADD COLUMN     "discountCents" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "promoCode" TEXT;

-- AlterTable
ALTER TABLE "Category" ADD COLUMN     "position" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Customer" ADD COLUMN     "emailVerifiedAt" TIMESTAMP(3),
ADD COLUMN     "lastLoginAt" TIMESTAMP(3),
ADD COLUMN     "passwordHash" TEXT;

-- AlterTable
ALTER TABLE "LoginAttempt" ADD COLUMN     "scope" TEXT NOT NULL DEFAULT 'admin';

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "billingAddressId" TEXT,
ADD COLUMN     "customerNote" TEXT,
ADD COLUMN     "discountCents" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "lastCheckedAt" TIMESTAMP(3),
ADD COLUMN     "nextReconcileAt" TIMESTAMP(3),
ADD COLUMN     "reconcileAttempts" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "ProductImage" ADD COLUMN     "mimeType" TEXT,
ADD COLUMN     "sizeBytes" INTEGER;

-- AlterTable
ALTER TABLE "Shipment" ADD COLUMN     "trackingUrl" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "active" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "lastLoginAt" TIMESTAMP(3),
ADD COLUMN     "name" TEXT,
ADD COLUMN     "totpEnabledAt" TIMESTAMP(3),
ADD COLUMN     "totpSecret" TEXT;

-- CreateTable
CREATE TABLE "CustomerSession" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomerSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VariantPrice" (
    "id" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "priceCents" INTEGER NOT NULL,

    CONSTRAINT "VariantPrice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PromoCode" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "kind" "PromoKind" NOT NULL,
    "value" INTEGER NOT NULL,
    "minSubtotalCents" INTEGER NOT NULL DEFAULT 0,
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "maxRedemptions" INTEGER,
    "maxPerCustomer" INTEGER,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PromoCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PromoRedemption" (
    "id" TEXT NOT NULL,
    "promoCodeId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "customerId" TEXT,
    "amountCents" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PromoRedemption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Review" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "customerId" TEXT,
    "orderId" TEXT,
    "authorName" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,
    "title" TEXT,
    "body" TEXT NOT NULL,
    "status" "ReviewStatus" NOT NULL DEFAULT 'PENDING',
    "moderatedById" TEXT,
    "moderatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Review_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Wishlist" (
    "id" TEXT NOT NULL,
    "customerId" TEXT,
    "sessionKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Wishlist_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WishlistItem" (
    "id" TEXT NOT NULL,
    "wishlistId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WishlistItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExchangeRate" (
    "id" TEXT NOT NULL,
    "base" TEXT NOT NULL,
    "quote" TEXT NOT NULL,
    "rate" DECIMAL(18,8) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExchangeRate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobRun" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'RUNNING',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "error" TEXT,
    "meta" JSONB,

    CONSTRAINT "JobRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CustomerSession_token_key" ON "CustomerSession"("token");

-- CreateIndex
CREATE INDEX "CustomerSession_customerId_idx" ON "CustomerSession"("customerId");

-- CreateIndex
CREATE INDEX "CustomerSession_expiresAt_idx" ON "CustomerSession"("expiresAt");

-- CreateIndex
CREATE INDEX "VariantPrice_variantId_idx" ON "VariantPrice"("variantId");

-- CreateIndex
CREATE UNIQUE INDEX "VariantPrice_variantId_currency_key" ON "VariantPrice"("variantId", "currency");

-- CreateIndex
CREATE UNIQUE INDEX "PromoCode_code_key" ON "PromoCode"("code");

-- CreateIndex
CREATE INDEX "PromoCode_code_idx" ON "PromoCode"("code");

-- CreateIndex
CREATE UNIQUE INDEX "PromoRedemption_orderId_key" ON "PromoRedemption"("orderId");

-- CreateIndex
CREATE INDEX "PromoRedemption_promoCodeId_idx" ON "PromoRedemption"("promoCodeId");

-- CreateIndex
CREATE INDEX "PromoRedemption_customerId_idx" ON "PromoRedemption"("customerId");

-- CreateIndex
CREATE INDEX "Review_productId_status_idx" ON "Review"("productId", "status");

-- CreateIndex
CREATE INDEX "Review_status_idx" ON "Review"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Review_productId_customerId_key" ON "Review"("productId", "customerId");

-- CreateIndex
CREATE UNIQUE INDEX "Wishlist_sessionKey_key" ON "Wishlist"("sessionKey");

-- CreateIndex
CREATE INDEX "Wishlist_customerId_idx" ON "Wishlist"("customerId");

-- CreateIndex
CREATE INDEX "WishlistItem_wishlistId_idx" ON "WishlistItem"("wishlistId");

-- CreateIndex
CREATE UNIQUE INDEX "WishlistItem_wishlistId_productId_key" ON "WishlistItem"("wishlistId", "productId");

-- CreateIndex
CREATE UNIQUE INDEX "ExchangeRate_base_quote_key" ON "ExchangeRate"("base", "quote");

-- CreateIndex
CREATE INDEX "JobRun_name_startedAt_idx" ON "JobRun"("name", "startedAt");

-- CreateIndex
CREATE INDEX "JobRun_status_idx" ON "JobRun"("status");

-- CreateIndex
CREATE INDEX "LoginAttempt_scope_identifier_createdAt_idx" ON "LoginAttempt"("scope", "identifier", "createdAt");

-- CreateIndex
CREATE INDEX "Payment_status_nextReconcileAt_idx" ON "Payment"("status", "nextReconcileAt");

-- CreateIndex
CREATE INDEX "Product_name_idx" ON "Product"("name");

-- AddForeignKey
ALTER TABLE "CustomerSession" ADD CONSTRAINT "CustomerSession_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VariantPrice" ADD CONSTRAINT "VariantPrice_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "Variant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_billingAddressId_fkey" FOREIGN KEY ("billingAddressId") REFERENCES "Address"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromoRedemption" ADD CONSTRAINT "PromoRedemption_promoCodeId_fkey" FOREIGN KEY ("promoCodeId") REFERENCES "PromoCode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromoRedemption" ADD CONSTRAINT "PromoRedemption_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromoRedemption" ADD CONSTRAINT "PromoRedemption_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Review" ADD CONSTRAINT "Review_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Review" ADD CONSTRAINT "Review_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Review" ADD CONSTRAINT "Review_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Review" ADD CONSTRAINT "Review_moderatedById_fkey" FOREIGN KEY ("moderatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Wishlist" ADD CONSTRAINT "Wishlist_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WishlistItem" ADD CONSTRAINT "WishlistItem_wishlistId_fkey" FOREIGN KEY ("wishlistId") REFERENCES "Wishlist"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WishlistItem" ADD CONSTRAINT "WishlistItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

