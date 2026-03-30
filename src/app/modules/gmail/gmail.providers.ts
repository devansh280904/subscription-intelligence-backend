/**
 * PROVIDER REGISTRY
 * ==================
 * Single source of truth for every subscription provider we support.
 *
 * KEY RULES to keep scans fast:
 *  1. No two providers share the same domain. Shared domains (apple.com,
 *     google.com, amazon.com) must be disambiguated with subjectFilter so
 *     the Gmail query itself is narrow. Otherwise the same 50+ emails get
 *     fetched, decoded, and classified multiple times.
 *  2. subjectFilter — if set, it is appended to the Gmail `q=` query as
 *     additional subject keywords. This cuts the result set before any
 *     network round-trip for body content.
 *  3. billingSubjectHints — used by the classifier (not the query).
 */

export interface ProviderConfig {
  name: string;
  domains: string[];
  category: 'streaming' | 'music' | 'cloud' | 'productivity' | 'dev' | 'social' | 'ai' | 'design' | 'other';
  defaultCycle?: 'MONTHLY' | 'YEARLY' | 'QUARTERLY' | 'WEEKLY';
  /** Extra Gmail query terms appended after the from: clause (e.g. subject keywords) */
  subjectFilter?: string;
  billingSubjectHints?: string[];
}

export const PROVIDER_REGISTRY: ProviderConfig[] = [
  // ── Streaming ──────────────────────────────────────────────────────────────
  {
    name: 'Netflix',
    domains: ['netflix.com', 'mailer.netflix.com', 'members.netflix.com'],
    category: 'streaming',
    defaultCycle: 'MONTHLY',
    billingSubjectHints: ['your next payment', 'payment confirmation', 'membership', 'receipt'],
  },
  {
    name: 'Disney+',
    domains: ['disneyplus.com', 'mail.disneyplus.com'],
    category: 'streaming',
    defaultCycle: 'MONTHLY',
    billingSubjectHints: ['subscription', 'billing', 'payment', 'receipt'],
  },
  {
    name: 'Hotstar',
    domains: ['hotstar.com', 'mail.hotstar.com'],
    category: 'streaming',
    defaultCycle: 'MONTHLY',
    billingSubjectHints: ['subscription', 'payment', 'renewal'],
  },
  {
    name: 'JioCinema',
    domains: ['jiocinema.com'],
    category: 'streaming',
    defaultCycle: 'MONTHLY',
  },
  {
    name: 'SonyLIV',
    domains: ['sonyliv.com'],
    category: 'streaming',
    defaultCycle: 'MONTHLY',
  },
  {
    name: 'ZEE5',
    domains: ['zee5.com'],
    category: 'streaming',
    defaultCycle: 'MONTHLY',
  },

  // ── Music ──────────────────────────────────────────────────────────────────
  {
    name: 'Spotify',
    domains: ['spotify.com', 'notifications.spotify.com'],
    category: 'music',
    defaultCycle: 'MONTHLY',
    billingSubjectHints: ['receipt', 'payment', 'subscription', 'renewal'],
  },

  // ── Amazon — split by product to avoid fetching all amazon.com emails ──────
  // Amazon Prime billing comes from amazon.in / amazon.com with "prime" in subject
  {
    name: 'Amazon Prime',
    domains: ['amazon.in', 'amazon.com', 'primevideo.com'],
    category: 'streaming',
    defaultCycle: 'MONTHLY',
    // Narrows the Gmail query so we only fetch Prime-related emails, not every
    // Amazon order / shipment / marketing email.
    subjectFilter: 'subject:(prime OR membership OR "auto-renew")',
    billingSubjectHints: ['prime', 'membership', 'renewal', 'auto-renew'],
  },
  // AWS billing comes from aws.amazon.com / billing@amazon.com
  {
    name: 'AWS',
    domains: ['aws.amazon.com'],
    category: 'dev',
    subjectFilter: 'subject:(AWS OR "Amazon Web Services" OR invoice OR bill)',
    billingSubjectHints: ['aws', 'amazon web services', 'invoice'],
  },

  // ── Apple — split by product so we don't scan 57 emails for each ──────────
  // Apple Music receipts always contain "Apple Music" in subject
  {
    name: 'Apple Music',
    domains: ['apple.com', 'appleid.apple.com'],
    category: 'music',
    defaultCycle: 'MONTHLY',
    subjectFilter: 'subject:("Apple Music" OR "receipt" OR "subscription")',
    billingSubjectHints: ['apple music', 'your receipt from apple'],
  },
  // iCloud+ receipts contain "iCloud" in subject
  {
    name: 'iCloud+',
    domains: ['apple.com', 'appleid.apple.com'],
    category: 'cloud',
    defaultCycle: 'MONTHLY',
    subjectFilter: 'subject:(iCloud OR "storage" OR "receipt")',
    billingSubjectHints: ['icloud', 'your receipt from apple'],
  },
  // Apple One / Apple TV+ / Arcade — catch remaining Apple receipts
  {
    name: 'Apple One',
    domains: ['apple.com', 'appleid.apple.com'],
    category: 'other',
    defaultCycle: 'MONTHLY',
    subjectFilter: 'subject:("Apple One" OR "Apple TV" OR "Apple Arcade" OR "Apple Fitness" OR "Your receipt from Apple")',
    billingSubjectHints: ['apple one', 'apple tv+', 'apple arcade', 'apple fitness', 'your receipt from apple'],
  },

  // ── Google — split by product ──────────────────────────────────────────────
  {
    name: 'YouTube Premium',
    domains: ['youtube.com', 'accounts.google.com'],
    category: 'streaming',
    defaultCycle: 'MONTHLY',
    subjectFilter: 'subject:("YouTube Premium" OR "YouTube Music")',
    billingSubjectHints: ['youtube premium', 'youtube music'],
  },
  {
    name: 'Google One',
    domains: ['google.com', 'one.google.com', 'payments.google.com'],
    category: 'cloud',
    defaultCycle: 'MONTHLY',
    subjectFilter: 'subject:("Google One" OR "storage" OR "receipt" OR "subscription")',
    billingSubjectHints: ['google one', 'storage'],
  },
  {
    name: 'Google Workspace',
    domains: ['google.com', 'workspace.google.com'],
    category: 'productivity',
    subjectFilter: 'subject:("Google Workspace" OR "G Suite")',
    billingSubjectHints: ['google workspace', 'g suite'],
  },

  // ── Cloud ──────────────────────────────────────────────────────────────────
  {
    name: 'Dropbox',
    domains: ['dropbox.com'],
    category: 'cloud',
    defaultCycle: 'MONTHLY',
    billingSubjectHints: ['subscription', 'billing', 'renewal'],
  },

  // ── Productivity ───────────────────────────────────────────────────────────
  {
    name: 'Microsoft 365',
    domains: ['microsoft.com', 'email.microsoftemail.com'],
    category: 'productivity',
    defaultCycle: 'MONTHLY',
    subjectFilter: 'subject:("Microsoft 365" OR "Office 365" OR subscription OR renewal)',
    billingSubjectHints: ['microsoft 365', 'office 365', 'subscription', 'renewal'],
  },
  // {
  //   name: 'Notion',
  //   domains: ['notion.so', 'mail.notion.so'],
  //   category: 'productivity',
  //   defaultCycle: 'MONTHLY',
  //   billingSubjectHints: ['subscription', 'billing', 'renewal'],
  // },
  // {
  //   name: 'Todoist',
  //   domains: ['todoist.com', 'doist.com'],
  //   category: 'productivity',
  //   defaultCycle: 'MONTHLY',
  // },
  // {
  //   name: 'Evernote',
  //   domains: ['evernote.com'],
  //   category: 'productivity',
  //   defaultCycle: 'MONTHLY',
  // },
  {
    name: 'Grammarly',
    domains: ['grammarly.com'],
    category: 'productivity',
    defaultCycle: 'MONTHLY',
    billingSubjectHints: ['subscription', 'billing', 'renewal', 'premium'],
  },

  // ── Design ─────────────────────────────────────────────────────────────────
  {
    name: 'Figma',
    domains: ['figma.com', 'mail.figma.com'],
    category: 'design',
    defaultCycle: 'MONTHLY',
    billingSubjectHints: ['subscription', 'billing', 'renewal', 'invoice'],
  },
  {
    name: 'Canva',
    domains: ['canva.com'],
    category: 'design',
    defaultCycle: 'MONTHLY',
    billingSubjectHints: ['subscription', 'billing', 'pro', 'renewal'],
  },
  {
    name: 'Adobe Creative Cloud',
    domains: ['adobe.com', 'mail.adobe.com', 'email.adobe.com'],
    category: 'design',
    defaultCycle: 'MONTHLY',
    billingSubjectHints: ['subscription', 'billing', 'creative cloud', 'renewal'],
  },

  // ── Dev tools ──────────────────────────────────────────────────────────────
  {
    name: 'GitHub',
    domains: ['github.com', 'mail.github.com'],
    category: 'dev',
    defaultCycle: 'MONTHLY',
    billingSubjectHints: ['github', 'subscription', 'billing'],
  },
  // {
  //   name: 'GitLab',
  //   domains: ['gitlab.com'],
  //   category: 'dev',
  //   defaultCycle: 'MONTHLY',
  // },
  // {
  //   name: 'Vercel',
  //   domains: ['vercel.com'],
  //   category: 'dev',
  //   defaultCycle: 'MONTHLY',
  // },
  // {
  //   name: 'DigitalOcean',
  //   domains: ['digitalocean.com', 'do.co'],
  //   category: 'dev',
  //   defaultCycle: 'MONTHLY',
  // },
  // {
  //   name: 'Heroku',
  //   domains: ['heroku.com'],
  //   category: 'dev',
  //   defaultCycle: 'MONTHLY',
  // },
  // {
  //   name: 'Netlify',
  //   domains: ['netlify.com'],
  //   category: 'dev',
  //   defaultCycle: 'MONTHLY',
  // },
  // {
  //   name: 'Supabase',
  //   domains: ['supabase.com', 'supabase.io'],
  //   category: 'dev',
  //   defaultCycle: 'MONTHLY',
  // },
  // {
  //   name: 'PlanetScale',
  //   domains: ['planetscale.com'],
  //   category: 'dev',
  //   defaultCycle: 'MONTHLY',
  // },

  // ── Social / Professional ──────────────────────────────────────────────────
  {
    name: 'LinkedIn Premium',
    domains: ['linkedin.com', 'e.linkedin.com', 'em.linkedin.com'],
    category: 'social',
    defaultCycle: 'MONTHLY',
    subjectFilter: 'subject:(premium OR subscription OR billing OR renewal OR invoice)',
    billingSubjectHints: ['premium', 'subscription', 'billing', 'renewal', 'invoice'],
  },
  // {
  //   name: 'Twitter / X Premium',
  //   domains: ['twitter.com', 'x.com', 'mail.x.com'],
  //   category: 'social',
  //   defaultCycle: 'MONTHLY',
  //   billingSubjectHints: ['premium', 'subscription', 'billing'],
  // },

  // ── AI tools ───────────────────────────────────────────────────────────────
  {
    name: 'ChatGPT Plus',
    domains: ['openai.com', 'mail.openai.com'],
    category: 'ai',
    defaultCycle: 'MONTHLY',
    billingSubjectHints: ['chatgpt plus', 'subscription', 'receipt', 'renewal'],
  },
  {
    name: 'Claude Pro',
    domains: ['anthropic.com'],
    category: 'ai',
    defaultCycle: 'MONTHLY',
    billingSubjectHints: ['claude pro', 'subscription', 'billing'],
  },
  {
    name: 'Midjourney',
    domains: ['midjourney.com'],
    category: 'ai',
    defaultCycle: 'MONTHLY',
    billingSubjectHints: ['subscription', 'billing'],
  },
  {
    name: 'Perplexity',
    domains: ['perplexity.ai'],
    category: 'ai',
    defaultCycle: 'MONTHLY',
  },
  {
    name: 'Cursor',
    domains: ['cursor.sh', 'cursor.com'],
    category: 'ai',
    defaultCycle: 'MONTHLY',
  },

  // // ── Communication ──────────────────────────────────────────────────────────
  // {
  //   name: 'Zoom',
  //   domains: ['zoom.us', 'zoom.com'],
  //   category: 'other',
  //   defaultCycle: 'MONTHLY',
  //   billingSubjectHints: ['subscription', 'billing', 'renewal'],
  // },
  // {
  //   name: 'Slack',
  //   domains: ['slack.com'],
  //   category: 'other',
  //   defaultCycle: 'MONTHLY',
  //   billingSubjectHints: ['subscription', 'billing', 'renewal', 'invoice'],
  // },

  // // ── Learning ───────────────────────────────────────────────────────────────
  // {
  //   name: 'Coursera',
  //   domains: ['coursera.org', 'mail.coursera.org'],
  //   category: 'other',
  //   defaultCycle: 'MONTHLY',
  //   billingSubjectHints: ['coursera plus', 'subscription', 'billing', 'renewal'],
  // },
  // {
  //   name: 'Udemy',
  //   domains: ['udemy.com'],
  //   category: 'other',
  //   defaultCycle: 'MONTHLY',
  // },
  // {
  //   name: 'Skillshare',
  //   domains: ['skillshare.com'],
  //   category: 'other',
  //   defaultCycle: 'MONTHLY',
  // },
  // {
  //   name: 'Duolingo',
  //   domains: ['duolingo.com'],
  //   category: 'other',
  //   defaultCycle: 'MONTHLY',
  //   billingSubjectHints: ['super duolingo', 'subscription', 'billing'],
  // },

  // ── Other ──────────────────────────────────────────────────────────────────
  // {
  //   name: '1Password',
  //   domains: ['1password.com'],
  //   category: 'other',
  //   defaultCycle: 'MONTHLY',
  // },
  // {
  //   name: 'LastPass',
  //   domains: ['lastpass.com'],
  //   category: 'other',
  //   defaultCycle: 'MONTHLY',
  // },
  // {
  //   name: 'NordVPN',
  //   domains: ['nordvpn.com'],
  //   category: 'other',
  //   defaultCycle: 'MONTHLY',
  // },
  // {
  //   name: 'ExpressVPN',
  //   domains: ['expressvpn.com'],
  //   category: 'other',
  //   defaultCycle: 'MONTHLY',
  // },
];

/**
 * Build the Gmail search query for a single provider.
 *
 * If the provider has a `subjectFilter`, it is appended to narrow results.
 * This is the primary performance lever — it prevents fetching hundreds of
 * non-billing emails from providers like Apple or Amazon.
 *
 * Example — Amazon Prime:
 *   (from:amazon.in OR from:amazon.com OR from:primevideo.com)
 *   subject:(prime OR membership OR "auto-renew") after:2025/09/01
 *
 * Example — Netflix (no filter needed, domain is unique enough):
 *   (from:netflix.com OR from:mailer.netflix.com OR from:members.netflix.com)
 *   after:2025/09/01
 */
export function buildProviderQuery(provider: ProviderConfig, afterDate: string): string {
  const fromClauses = provider.domains.map(d => `from:${d}`).join(' OR ');
  const base = `(${fromClauses})`;
  return provider.subjectFilter
    ? `${base} ${provider.subjectFilter} after:${afterDate}`
    : `${base} after:${afterDate}`;
}

/** Get a provider config by name (case-insensitive). */
export function getProviderByName(name: string): ProviderConfig | undefined {
  return PROVIDER_REGISTRY.find(p => p.name.toLowerCase() === name.toLowerCase());
}

/**
 * Detect which provider an email is from based on the sender domain.
 *
 * NOTE: When multiple providers share a domain (apple.com, google.com,
 * amazon.com) this will always return the FIRST match. That is intentional —
 * the historical scan worker passes the actual email subject/body to the
 * classifier afterwards, which resolves the ambiguity. The provider returned
 * here is used only for the `provider` field in the DB record, so callers
 * that need precise attribution should pass the ProviderConfig directly (as
 * the historical scan worker already does via `scanProvider`).
 */
export function detectProvider(fromHeader: string | null): ProviderConfig | null {
  if (!fromHeader) return null;

  const domainMatch = fromHeader.match(/@([\w.-]+)/);
  if (!domainMatch) return null;

  const senderDomain = domainMatch[1].toLowerCase();

  for (const provider of PROVIDER_REGISTRY) {
    for (const d of provider.domains) {
      if (senderDomain === d || senderDomain.endsWith(`.${d}`)) {
        return provider;
      }
    }
  }

  return null;
}