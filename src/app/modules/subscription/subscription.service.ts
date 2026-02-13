import prisma from '../../config/prisma';
import { SubscriptionStatus, BillingCycle } from '@prisma/client';

/**
 * Subscription Service
 * Handles all business logic for subscription management
 */

// Get all subscriptions for a user with grouping and statistics
export async function getUserSubscriptions(userId: string) {
    // SELECT * FROM Subscription WHERE userId = 'xyz';
  const subscriptions = await prisma.subscription.findMany({
    where: { userId },
    include: {
      paymentCycles: {
        orderBy: {
          paymentDate: 'desc',
        },
        take: 5, // Last 5 payments
      },
    },
    orderBy: {
      status: 'asc', // Active first
    },
  });

  // Group by status
  const grouped = {
    active: subscriptions.filter((s) => s.status === SubscriptionStatus.ACTIVE),
    cancelled: subscriptions.filter((s) => s.status === SubscriptionStatus.CANCELLED),
    paymentFailed: subscriptions.filter((s) => s.status === SubscriptionStatus.PAYMENT_FAILED),
    trial: subscriptions.filter((s) => s.status === SubscriptionStatus.TRIAL),
    paused: subscriptions.filter((s) => s.status === SubscriptionStatus.PAUSED),
    needsConfirmation: subscriptions.filter((s) => s.needsConfirmation),
  };

  // Calculate statistics
  const stats = calculateSubscriptionStats(grouped);

  return {
    subscriptions: grouped,
    stats,
  };
}

// Get a single subscription with full payment history
export async function getSubscriptionById(userId: string, subscriptionId: string) {
  const subscription = await prisma.subscription.findFirst({
    where: {
      id: subscriptionId,
      userId,
    },
    include: {
      paymentCycles: {
        orderBy: {
          paymentDate: 'desc',
        },
      },
    },
  });

  if (!subscription) {
    return null;
  }

  // Calculate cycle statistics
  const cycleStats = calculatePaymentCycleStats(subscription.paymentCycles);

  return {
    subscription,
    cycleStats,
  };
}

// Confirm a subscription
export async function confirmSubscription(userId: string, subscriptionId: string) {
  const subscription = await prisma.subscription.findFirst({
    where: {
      id: subscriptionId,
      userId,
    },
  });

  if (!subscription) {
    return null;
  }

  const updated = await prisma.subscription.update({
    where: { id: subscriptionId },
    data: {
      needsConfirmation: false,
      confirmedAt: new Date(),
    },
  });

  return updated;
}

// Update a subscription
export async function updateSubscription(
  userId: string,
  subscriptionId: string,
  updateData: {
    provider?: string;
    amount?: number;
    currency?: string;
    billingCycle?: BillingCycle;
    renewalDate?: string;
    planName?: string;
    status?: SubscriptionStatus;
    userNotes?: string;
  }
) {
  const subscription = await prisma.subscription.findFirst({
    where: {
      id: subscriptionId,
      userId,
    },
  });

  if (!subscription) {
    return null;
  }

  // Prepare update data
  const dataToUpdate: any = {
    needsConfirmation: false, // Auto-confirm when user edits
    confirmedAt: new Date(),
  };

  if (updateData.provider !== undefined) {
    dataToUpdate.provider = updateData.provider;
  }
  if (updateData.amount !== undefined) {
    dataToUpdate.amount = parseFloat(String(updateData.amount));
  }
  if (updateData.currency !== undefined) {
    dataToUpdate.currency = updateData.currency;
  }
  if (updateData.billingCycle !== undefined) {
    dataToUpdate.billingCycle = updateData.billingCycle;
  }
  if (updateData.renewalDate !== undefined) {
    dataToUpdate.renewalDate = new Date(updateData.renewalDate);
  }
  if (updateData.planName !== undefined) {
    dataToUpdate.planName = updateData.planName;
  }
  if (updateData.status !== undefined) {
    dataToUpdate.status = updateData.status;
  }
  if (updateData.userNotes !== undefined) {
    dataToUpdate.userNotes = updateData.userNotes;
  }

  const updated = await prisma.subscription.update({
    where: { id: subscriptionId },
    data: dataToUpdate,
  });

  return updated;
}

// Delete a subscription
export async function deleteSubscription(userId: string, subscriptionId: string) {
  const subscription = await prisma.subscription.findFirst({
    where: {
      id: subscriptionId,
      userId,
    },
  });

  if (!subscription) {
    return null;
  }

  await prisma.subscription.delete({
    where: { id: subscriptionId },
  });

  return true;
}

// Get upcoming renewals (next 30 days)
export async function getUpcomingRenewals(userId: string) {
  const now = new Date();
  const thirtyDaysFromNow = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

  const upcomingRenewals = await prisma.subscription.findMany({
    where: {
      userId,
      status: SubscriptionStatus.ACTIVE,
      renewalDate: {
        gte: now,
        lte: thirtyDaysFromNow,
      },
    },
    orderBy: {
      renewalDate: 'asc',
    },
  });

  return {
    count: upcomingRenewals.length,
    renewals: upcomingRenewals,
  };
}

// Helper: Calculate subscription statistics
function calculateSubscriptionStats(grouped: {
  active: any[];
  cancelled: any[];
  paymentFailed: any[];
  trial: any[];
  paused: any[];
  needsConfirmation: any[];
}) {

    /*
    let monthlySpend = 0;

    for (const s of grouped.active) {
    if (s.billingCycle === BillingCycle.MONTHLY && s.amount) {
        monthlySpend += s.amount;
    }
    }
    */
  const monthlySpend = grouped.active
    .filter((s) => s.billingCycle === BillingCycle.MONTHLY && s.amount)
    .reduce((sum, s) => sum + (s.amount || 0), 0);

  const yearlySpend = grouped.active
    .filter((s) => s.billingCycle === BillingCycle.YEARLY && s.amount)
    .reduce((sum, s) => sum + (s.amount || 0), 0);

  const quarterlySpend = grouped.active
    .filter((s) => s.billingCycle === BillingCycle.QUARTERLY && s.amount)
    .reduce((sum, s) => sum + (s.amount || 0), 0);

  const weeklySpend = grouped.active
    .filter((s) => s.billingCycle === BillingCycle.WEEKLY && s.amount)
    .reduce((sum, s) => sum + (s.amount || 0), 0);

  // Calculate estimated monthly cost (normalize all to monthly)
  const estimatedMonthlySpend =
    monthlySpend +
    yearlySpend / 12 +
    quarterlySpend / 3 +
    weeklySpend * 4.33;

  const upcomingRenewals = grouped.active.filter(
    (s) => s.renewalDate && s.renewalDate <= new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
  ).length;

  return {
    totalActive: grouped.active.length,
    totalCancelled: grouped.cancelled.length,
    totalPaymentFailed: grouped.paymentFailed.length,
    totalTrial: grouped.trial.length,
    totalPaused: grouped.paused.length,
    needsConfirmation: grouped.needsConfirmation.length,
    monthlySpend: Math.round(monthlySpend * 100) / 100,
    yearlySpend: Math.round(yearlySpend * 100) / 100,
    quarterlySpend: Math.round(quarterlySpend * 100) / 100,
    weeklySpend: Math.round(weeklySpend * 100) / 100,
    estimatedMonthlySpend: Math.round(estimatedMonthlySpend * 100) / 100,
    estimatedYearlySpend: Math.round(estimatedMonthlySpend * 12 * 100) / 100,
    upcomingRenewals,
  };
}

// Helper: Calculate payment cycle statistics
function calculatePaymentCycleStats(paymentCycles: any[]) {
  const successfulPayments = paymentCycles.filter((p) => p.status === 'SUCCESS');
  const failedPayments = paymentCycles.filter((p) => p.status === 'FAILED');
  const pendingPayments = paymentCycles.filter((p) => p.status === 'PENDING');

  const totalSpent = successfulPayments.reduce((sum, p) => sum + p.amount, 0);
  const averageAmount = successfulPayments.length
    ? totalSpent / successfulPayments.length
    : 0;

  return {
    totalCycles: successfulPayments.length,
    totalSpent: Math.round(totalSpent * 100) / 100,
    failedPayments: failedPayments.length,
    pendingPayments: pendingPayments.length,
    averageAmount: Math.round(averageAmount * 100) / 100,
  };
}

// Validate enum values
export function validateStatus(status: string): status is SubscriptionStatus {
  return Object.values(SubscriptionStatus).includes(status as SubscriptionStatus);
}

export function validateBillingCycle(cycle: string): cycle is BillingCycle {
  return Object.values(BillingCycle).includes(cycle as BillingCycle);
}