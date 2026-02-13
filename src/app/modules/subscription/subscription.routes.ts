import { Router } from 'express';
import { authMiddleware } from '../../middlewares/auth.middleware';
import * as subscriptionController from './subscription.controller';

/**
 * Subscription Routes
 * Defines all subscription management endpoints
 * 
 * Base path: /api/subscriptions
 */

const router = Router();

// ============================================
// PUBLIC ROUTES (require authentication)
// ============================================

/**
 * @route   GET /api/subscriptions
 * @desc    Get all subscriptions for the authenticated user
 * @access  Private
 */
router.get(
  '/',
  authMiddleware,
  subscriptionController.getAllSubscriptions
);

/**
 * @route   GET /api/subscriptions/upcoming-renewals
 * @desc    Get subscriptions renewing in the next 30 days
 * @access  Private
 * @note    Must be defined BEFORE /:id route to avoid matching "upcoming-renewals" as an ID
 */
router.get(
  '/upcoming-renewals',
  authMiddleware,
  subscriptionController.getUpcomingRenewals
);

/**
 * @route   GET /api/subscriptions/:id
 * @desc    Get a single subscription with full payment history
 * @access  Private
 */
router.get(
  '/:id',
  authMiddleware,
  subscriptionController.getSubscriptionById
);

/**
 * @route   POST /api/subscriptions/:id/confirm
 * @desc    Confirm that AI-extracted subscription data is correct
 * @access  Private
 */
router.post(
  '/:id/confirm',
  authMiddleware,
  subscriptionController.confirmSubscription
);

/**
 * @route   PATCH /api/subscriptions/:id
 * @desc    Update subscription details (user corrections)
 * @access  Private
 * @body    { provider?, amount?, currency?, billingCycle?, renewalDate?, planName?, status?, userNotes? }
 */
router.patch(
  '/:id',
  authMiddleware,
  subscriptionController.updateSubscription
);

/**
 * @route   DELETE /api/subscriptions/:id
 * @desc    Delete a subscription
 * @access  Private
 */
router.delete(
  '/:id',
  authMiddleware,
  subscriptionController.deleteSubscription
);

export default router;