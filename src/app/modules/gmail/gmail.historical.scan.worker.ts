import prisma from '../../config/prisma';
import {
  scanGmailMessageIds,
  fetchGmailMessageHeaders,
  fetchGmailMessageContent,
} from './gmail.scanner';
import { classifySubscriptionEmail } from './gmail.classifier';
import { extractAllSubscriptionData } from './gmail.parser';
import { SubscriptionStatus } from '@prisma/client';

/**
 * Improved Historical Gmail Scanner (No LLM)
 * Fixes: 
 * 1. Scans from Oct 2025 (includes your confirmation email)
 * 2. Processes confirmation emails FIRST
 * 3. Then processes chronologically (oldest to newest)
 */

interface EmailToProcess {
  messageId: string;
  date: Date;
  priority: number;
  subject: string;
}

// Helper function to map lifecycle to status
function mapLifecycleToStatus(lifecycleEvent?: string): SubscriptionStatus {
  switch (lifecycleEvent) {
    case 'CANCELLED':
      return SubscriptionStatus.CANCELLED;
    case 'PAYMENT_FAILED':
      return SubscriptionStatus.PAYMENT_FAILED;
    case 'TRIAL_ENDING':
      return SubscriptionStatus.TRIAL;
    default:
      return SubscriptionStatus.ACTIVE;
  }
}

export async function runHistoricalScan(userId: string): Promise<void> {
  console.log(`🚀 Starting historical scan for user ${userId}`);

  const gmailAccount = await prisma.gmailAccount.findUnique({
    where: { userId },
  });

  if (!gmailAccount) {
    throw new Error('Gmail account not found');
  }

  // ✅ FIX 1: Include emails from Oct 2025 onwards
  const searchQuery = 'subscription OR billing OR invoice OR receipt after:2025/10/01';
  
  console.log(`🔍 Search query: ${searchQuery}`);

  let allMessageIds: string[] = [];
  let pageToken: string | undefined = undefined;
  let pageCount = 0;
  const MAX_PAGES = 20;

  // Fetch all message IDs
  do {
    const response = await scanGmailMessageIds(
      gmailAccount.accessToken,
      gmailAccount.refreshToken,
      {
        maxResults: 100,
        query: searchQuery,
        pageToken,
      }
    );

    allMessageIds.push(...response.messageIds);
    pageToken = response.nextPageToken;
    pageCount++;

    console.log(`📄 Fetched page ${pageCount}, total messages: ${allMessageIds.length}`);
  } while (pageToken && pageCount < MAX_PAGES);

  console.log(`📊 Total messages to process: ${allMessageIds.length}`);

  // ✅ FIX 2: Fetch headers and assign priorities
  const emailsToProcess: EmailToProcess[] = [];

  for (const messageId of allMessageIds) {
    try {
      const headers = await fetchGmailMessageHeaders(
        gmailAccount.accessToken,
        gmailAccount.refreshToken,
        messageId
      );

      const classification = classifySubscriptionEmail(
        {
          from: headers.from,
          subject: headers.subject,
        },
        ''
      );

      if (!classification.isSubscriptionCandidate) {
        console.log(`⏭️  Skipping: ${headers.subject}`);
        continue;
      }

      let priority = 3;
      const subject = (headers.subject || '').toLowerCase();

      if (
        subject.includes('subscription confirmed') ||
        subject.includes('subscription is confirmed') ||
        subject.includes('welcome to your subscription') ||
        subject.includes('thank you for subscribing')
      ) {
        priority = 1;
        console.log(`🎯 PRIORITY 1 (Confirmation): ${headers.subject}`);
      } else if (
        subject.includes('receipt') ||
        subject.includes('payment successful') ||
        subject.includes('your payment')
      ) {
        priority = 2;
        console.log(`💰 PRIORITY 2 (Payment): ${headers.subject}`);
      } else {
        console.log(`📧 PRIORITY 3 (Other): ${headers.subject}`);
      }

      emailsToProcess.push({
        messageId,
        date: new Date(headers.date || Date.now()),
        priority,
        subject: headers.subject || '',
      });
    } catch (error) {
      console.error(`❌ Error fetching headers for ${messageId}:`, error);
    }
  }

  // ✅ FIX 3: Sort by priority FIRST, then by date
  emailsToProcess.sort((a, b) => {
    if (a.priority !== b.priority) {
      return a.priority - b.priority;
    }
    return a.date.getTime() - b.date.getTime();
  });

  console.log(`\n📋 Processing order:`);
  console.log(`   - ${emailsToProcess.filter(e => e.priority === 1).length} confirmation emails`);
  console.log(`   - ${emailsToProcess.filter(e => e.priority === 2).length} payment emails`);
  console.log(`   - ${emailsToProcess.filter(e => e.priority === 3).length} other emails`);

  let processedCount = 0;
  let skippedCount = 0;
  let errorCount = 0;

  for (const email of emailsToProcess) {
    try {
      console.log(`\n📧 [Priority ${email.priority}] ${email.subject.substring(0, 50)}...`);
      console.log(`   Date: ${email.date.toISOString()}`);

      const headers = await fetchGmailMessageHeaders(
        gmailAccount.accessToken,
        gmailAccount.refreshToken,
        email.messageId
      );

      const { bodyText, pdfText } = await fetchGmailMessageContent(
        gmailAccount.accessToken,
        gmailAccount.refreshToken,
        email.messageId
      );

      const classification = classifySubscriptionEmail(
        {
          from: headers.from,
          subject: headers.subject,
        },
        bodyText
      );

      if (!classification.isSubscriptionCandidate) {
        console.log(`⏭️  Skipped after full classification`);
        skippedCount++;
        continue;
      }

      // Extract subscription data
      const extracted = extractAllSubscriptionData(
        headers.from,
        bodyText,
        pdfText,
        headers.date
      );

      if (!extracted.provider) {
        console.log(`⚠️  No provider extracted, skipping`);
        skippedCount++;
        continue;
      }

      // Find or create subscription
      let subscription = await prisma.subscription.findFirst({
        where: {
          userId,
          provider: extracted.provider,
        },
      });

      if (!subscription) {
        // Create new subscription
        subscription = await prisma.subscription.create({
          data: {
            userId,
            provider: extracted.provider,
            status: mapLifecycleToStatus(classification.lifecycleEvent),
            startedAt: extracted.startedAt,
            amount: extracted.amount,
            currency: extracted.currency,
            billingCycle: extracted.billingCycle,
            renewalDate: extracted.renewalDate,
            planName: extracted.planName,
            lastEmailDate: new Date(headers.date || Date.now()),
            needsConfirmation: true,
          },
        });

        console.log(`✅ Created subscription: ${extracted.provider}`);
      } else {
        // Update existing subscription
        const updateData: any = {
          lastEmailDate: new Date(headers.date || Date.now()),
        };

        if (extracted.amount) updateData.amount = extracted.amount;
        if (extracted.currency) updateData.currency = extracted.currency;
        if (extracted.billingCycle) updateData.billingCycle = extracted.billingCycle;
        if (extracted.renewalDate) updateData.renewalDate = extracted.renewalDate;
        if (extracted.planName) updateData.planName = extracted.planName;

        const newStatus = mapLifecycleToStatus(classification.lifecycleEvent);
        if (newStatus === SubscriptionStatus.CANCELLED) {
          updateData.status = SubscriptionStatus.CANCELLED;
          updateData.endedAt = new Date(headers.date || Date.now());
        } else if (newStatus === SubscriptionStatus.PAYMENT_FAILED) {
          updateData.status = SubscriptionStatus.PAYMENT_FAILED;
        } else if (extracted.amount) {
          updateData.status = SubscriptionStatus.ACTIVE;
          updateData.endedAt = null;
        }

        subscription = await prisma.subscription.update({
          where: { id: subscription.id },
          data: updateData,
        });

        console.log(`📝 Updated subscription: ${extracted.provider}`);
      }

      // Create payment cycle if amount exists
      if (extracted.amount && extracted.amount > 0) {
        const existingCycle = await prisma.paymentCycle.findFirst({
          where: {
            subscriptionId: subscription.id,
            emailMessageId: email.messageId,
          },
        });

        if (!existingCycle) {
          await prisma.paymentCycle.create({
            data: {
              subscriptionId: subscription.id,
              amount: extracted.amount,
              currency: extracted.currency || 'INR',
              paymentDate: new Date(headers.date || Date.now()),
              status: classification.lifecycleEvent === 'PAYMENT_FAILED' ? 'FAILED' : 'SUCCESS',
              emailMessageId: email.messageId,
            },
          });

          console.log(`💰 Payment cycle: ₹${extracted.amount}`);
        }
      }

      processedCount++;

      // Small delay
      await new Promise((resolve) => setTimeout(resolve, 300));
    } catch (error) {
      console.error(`❌ Error processing ${email.messageId}:`, error);
      errorCount++;
    }
  }

  // Update scan completion
  await prisma.gmailAccount.update({
    where: { userId },
    data: {
      historicalScanCompleted: true,
      lastScannedAt: new Date(),
    },
  });

  console.log(`\n✅ Historical scan completed!`);
  console.log(`   - Processed: ${processedCount}`);
  console.log(`   - Skipped: ${skippedCount}`);
  console.log(`   - Errors: ${errorCount}`);
}