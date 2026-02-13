import { AuthRequest } from '../../middlewares/auth.middleware';
import { Response } from 'express';
import * as subscriptionService from './subscription.service';
import { SubscriptionStatus, BillingCycle } from '@prisma/client';

/**
 * Subscription Controller
 * Handles HTTP requests and responses for subscription endpoints
 */

// Helper function to extract string ID from params
function getParamId(paramId: string | string[] | undefined): string | null {
  if (!paramId) return null;
  return Array.isArray(paramId) ? paramId[0] : paramId;
}

// GET /api/subscriptions
// Get all subscriptions for the authenticated user
export const getAllSubscriptions = async (req: AuthRequest, res: Response) => {
  const userId = req.user?.userId;

  if (!userId) {
    return res.status(401).json({ message: 'Unauthorized' });
  }

  try {
    const result = await subscriptionService.getUserSubscriptions(userId);

    return res.json({
      success: true,
      data: result,
    });
  } catch (error) {
    console.error('Error fetching subscriptions:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch subscriptions',
    });
  }
};

// GET /api/subscriptions/upcoming-renewals
// Get subscriptions renewing in the next 30 days
export const getUpcomingRenewals = async (req: AuthRequest, res: Response) => {
  const userId = req.user?.userId;

  if (!userId) {
    return res.status(401).json({ message: 'Unauthorized' });
  }

  try {
    const result = await subscriptionService.getUpcomingRenewals(userId);

    return res.json({
      success: true,
      data: result,
    });
  } catch (error) {
    console.error('Error fetching upcoming renewals:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch upcoming renewals',
    });
  }
};

// GET /api/subscriptions/:id
// Get a single subscription with full payment history
export const getSubscriptionById = async (req: AuthRequest, res: Response) => {
  const userId = req.user?.userId;
  const id = getParamId(req.params.id);

  if (!userId) {
    return res.status(401).json({ message: 'Unauthorized' });
  }

  if (!id) {
    return res.status(400).json({
      success: false,
      message: 'Subscription ID is required',
    });
  }

  try {
    const result = await subscriptionService.getSubscriptionById(userId, id);

    if (!result) {
      return res.status(404).json({
        success: false,
        message: 'Subscription not found',
      });
    }

    return res.json({
      success: true,
      data: result,
    });
  } catch (error) {
    console.error('Error fetching subscription:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch subscription',
    });
  }
};

// POST /api/subscriptions/:id/confirm
// Confirm that the subscription data is correct
export const confirmSubscription = async (req: AuthRequest, res: Response) => {
  const userId = req.user?.userId;
  const id = getParamId(req.params.id);

  if (!userId) {
    return res.status(401).json({ message: 'Unauthorized' });
  }

  if (!id) {
    return res.status(400).json({
      success: false,
      message: 'Subscription ID is required',
    });
  }

  try {
    const subscription = await subscriptionService.confirmSubscription(userId, id);

    if (!subscription) {
      return res.status(404).json({
        success: false,
        message: 'Subscription not found',
      });
    }

    return res.json({
      success: true,
      message: 'Subscription confirmed',
      data: { subscription },
    });
  } catch (error) {
    console.error('Error confirming subscription:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to confirm subscription',
    });
  }
};

// PATCH /api/subscriptions/:id
// Update subscription details
export const updateSubscription = async (req: AuthRequest, res: Response) => {
  const userId = req.user?.userId;
  const id = getParamId(req.params.id);
  const {
    provider,
    amount,
    currency,
    billingCycle,
    renewalDate,
    planName,
    status,
    userNotes,
  } = req.body;

  if (!userId) {
    return res.status(401).json({ message: 'Unauthorized' });
  }

  if (!id) {
    return res.status(400).json({
      success: false,
      message: 'Subscription ID is required',
    });
  }

  // Validate enum values if provided
  if (status && !subscriptionService.validateStatus(status)) {
    return res.status(400).json({
      success: false,
      message: 'Invalid status value',
      validValues: Object.values(SubscriptionStatus),
    });
  }

  if (billingCycle && !subscriptionService.validateBillingCycle(billingCycle)) {
    return res.status(400).json({
      success: false,
      message: 'Invalid billing cycle value',
      validValues: Object.values(BillingCycle),
    });
  }

  try {
    const subscription = await subscriptionService.updateSubscription(userId, id, {
      provider,
      amount,
      currency,
      billingCycle,
      renewalDate,
      planName,
      status,
      userNotes,
    });

    if (!subscription) {
      return res.status(404).json({
        success: false,
        message: 'Subscription not found',
      });
    }

    return res.json({
      success: true,
      message: 'Subscription updated',
      data: { subscription },
    });
  } catch (error) {
    console.error('Error updating subscription:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to update subscription',
    });
  }
};

// DELETE /api/subscriptions/:id
// Delete a subscription
export const deleteSubscription = async (req: AuthRequest, res: Response) => {
  const userId = req.user?.userId;
  const id = getParamId(req.params.id);

  if (!userId) {
    return res.status(401).json({ message: 'Unauthorized' });
  }

  if (!id) {
    return res.status(400).json({
      success: false,
      message: 'Subscription ID is required',
    });
  }

  try {
    const result = await subscriptionService.deleteSubscription(userId, id);

    if (!result) {
      return res.status(404).json({
        success: false,
        message: 'Subscription not found',
      });
    }

    return res.json({
      success: true,
      message: 'Subscription deleted successfully',
    });
  } catch (error) {
    console.error('Error deleting subscription:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to delete subscription',
    });
  }
};