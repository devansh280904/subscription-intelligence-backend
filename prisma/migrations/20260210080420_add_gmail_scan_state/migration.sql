-- AlterTable
ALTER TABLE "GmailAccount" ADD COLUMN     "historicalScanCompleted" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "lastScannedAt" TIMESTAMP(3),
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
