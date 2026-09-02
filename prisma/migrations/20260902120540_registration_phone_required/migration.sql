/*
  Warnings:

  - Made the column `phone` on table `Registration` required. This step will fail if there are existing NULL values in that column.

*/
-- AlterTable
ALTER TABLE "Registration" ALTER COLUMN "phone" SET NOT NULL;
