-- CreateEnum
CREATE TYPE "MerchantAccountType" AS ENUM ('PERSONAL', 'MERCHANT');

-- AlterEnum
ALTER TYPE "DeliveryZone" ADD VALUE 'PICKUP';

-- AlterTable
ALTER TABLE "MerchantNumber" ADD COLUMN     "accountType" "MerchantAccountType" NOT NULL DEFAULT 'PERSONAL';

-- CreateTable
CREATE TABLE "StoreSettings" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "deliveryLusakaMinor" INTEGER NOT NULL DEFAULT 5000,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StoreSettings_pkey" PRIMARY KEY ("id")
);
