export const SECURITY_KEYWORDS = [
  'sign-in code',
  'security code',
  'verification code',
  'one-time password',
  'new device',
  'unusual activity',
  'password reset',
  'login alert',
];
export const CONFIRMATION_KEYWORDS = [
  'your subscription has started',
  'welcome to',
  'you are now subscribed',
  'membership is active',
  'subscription is now active',
];

export const TRIAL_ENDING_KEYWORDS = [
    'trial ends',
    'trial ending',
    'free trial expires',
    'trial expires',
    'trial period ends',
  ];


export const PLAN_LIFECYCLE_KEYWORDS = [
  'trial ends',
  'trial ending',
  'ends tomorrow',
  'renews soon',
  'will renew',
  'next billing',
  'update payment',
  'payment failed',
  'plan update',
  'changes to your plan',
  'subscription ends',
  'expires on',
];

export const CANCELLATION_KEYWORDS = [
  'subscription cancelled',
  'membership cancelled',
  'has been cancelled',
  'you have cancelled',
  'will not renew',
  'auto-renew turned off',
];

export const PAYMENT_FAILED_KEYWORDS = [
  'payment failed',
  'card declined',
  'could not process payment',
  'billing issue',
  'update your payment method',
];

export const POSITIVE_KEYWORDS = {
  strong: [
    'auto-renew',
    'automatically renew',
    'recurring',
    'renews on',
    'next billing date',
    'subscription will renew',
  ],
  medium: [
    'subscription',
    'membership',
    'billing cycle',
    'monthly',
    'annual',
    'yearly',
    'plan',
    'premium',
    'pro',
  ],
  weak: [
    'invoice',
    'receipt',
    'payment',
    'charged',
  ],
};

export const NEGATIVE_KEYWORDS = {
  strong: [
    'otp',
    'verification',
    'security code',
    'password reset',
    'login alert',
  ],
  commerce: [
    'order confirmed',
    'booking confirmed',
    'trip details',
    'your ride',
    'delivered',
    'food order',
    'ticket booked',
  ],
};
