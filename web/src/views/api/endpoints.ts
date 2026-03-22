export type ParamField = {
  name: string;
  in: 'path' | 'query' | 'header';
  type: 'string' | 'number';
  required: boolean;
  description: string;
  placeholder?: string;
};

export type Endpoint = {
  id: string;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  path: string;
  summary: string;
  description?: string;
  auth: 'none' | 'api_key' | 'admin_jwt' | 'cron_secret';
  params?: ParamField[];
};

export type EndpointGroup = {
  role: string;
  label: string;
  description: string;
  color: string;
  endpoints: Endpoint[];
};

export const endpointGroups: EndpointGroup[] = [
  {
    role: 'public',
    label: 'Public',
    description:
      'No authentication required. Rate-limited to 100 requests/day per IP.',
    color: '#22c55e',
    endpoints: [
      {
        id: 'signals-current',
        method: 'GET',
        path: '/api/v1/signals/current',
        summary: 'Latest signal snapshot',
        description:
          'Returns the most recent signal state: CORE_ON, MACRO_ON, ACCUM_ON, all scores (VAL, LIQ, DXY, CYCLE), BTC price, MVRV, Supply in Profit, and Euphoria Exhaustion diagnostics. Served from a 1-hour cache.',
        auth: 'none',
      },
    ],
  },
  {
    role: 'pro',
    label: 'Pro',
    description:
      'Requires an API key (X-API-Key header) or a signed-in Pro session. Available to Pro and Lifetime (1,000 calls/day) plus Pro+ (10,000 calls/day) subscribers.',
    color: '#60a5fa',
    endpoints: [
      {
        id: 'signals-history',
        method: 'GET',
        path: '/api/v1/signals/history',
        summary: 'Full signal history',
        description:
          'Returns the complete daily signal history. Optionally filter by date range using the "from" and "to" query parameters (YYYY-MM-DD format). Includes all scores, signals, BTC price, and diagnostic fields for every day, and returns X-RateLimit-* headers so clients can track remaining quota.',
        auth: 'api_key',
        params: [
          {
            name: 'from',
            in: 'query',
            type: 'string',
            required: false,
            description: 'Start date (inclusive)',
            placeholder: '2024-01-01',
          },
          {
            name: 'to',
            in: 'query',
            type: 'string',
            required: false,
            description: 'End date (inclusive)',
            placeholder: '2026-01-01',
          },
        ],
      },
      {
        id: 'series-detail',
        method: 'GET',
        path: '/api/pro/series-detail',
        summary: 'Single series history',
        description:
          'Returns the full historical time series for a single catalog series key (e.g. BTCUSD, MVRV, DXY_SCORE). Includes the latest value and all daily data points.',
        auth: 'api_key',
        params: [
          {
            name: 'key',
            in: 'query',
            type: 'string',
            required: true,
            description: 'Series key from the catalog (e.g. BTCUSD, MVRV, US_LIQ)',
            placeholder: 'BTCUSD',
          },
        ],
      },
      {
        id: 'alert-preferences',
        method: 'GET',
        path: '/api/pro/alerts/preferences',
        summary: 'Get alert preferences',
        description:
          'Returns the caller\'s signal alert preferences including enabled state, subscribed alert keys, and tier eligibility.',
        auth: 'admin_jwt',
      },
      {
        id: 'strategy-interpret',
        method: 'POST',
        path: '/api/pro/strategies/interpret',
        summary: 'Interpret natural-language strategy',
        description:
          'Turns a plain-English strategy prompt into a constrained draft strategy spec using the configured LLM provider or the built-in heuristic fallback.',
        auth: 'admin_jwt',
      },
      {
        id: 'strategy-preview',
        method: 'POST',
        path: '/api/pro/strategies/preview',
        summary: 'Preview custom strategy history',
        description:
          'Evaluates a validated strategy spec against the cached CoinStrat dataset and returns current state, recent flips, summary stats, and a historical preview window.',
        auth: 'admin_jwt',
      },
      {
        id: 'user-strategies',
        method: 'GET',
        path: '/api/pro/strategies',
        summary: 'List saved custom strategies',
        description:
          'Returns the caller\'s saved Signal Builder strategies, active preview metadata, and alert configuration.',
        auth: 'admin_jwt',
      },
    ],
  },
  {
    role: 'internal',
    label: 'Admin',
    description:
      'Available to admins in the browser via their signed-in session token, and to server-side automation via CRON_SECRET.',
    color: '#f59e0b',
    endpoints: [
      {
        id: 'signals-refresh',
        method: 'POST',
        path: '/api/v1/signals/refresh',
        summary: 'Refresh signal cache',
        description:
          'Runs an incremental server-side refresh by default and appends any new signal rows to the Netlify Blob cache. It also accepts a precomputed signal array for manual seeding.',
        auth: 'admin_jwt',
      },
      {
        id: 'weekly-digest',
        method: 'POST',
        path: '/api/email/digest',
        summary: 'Send weekly digest email',
        description:
          'Runs the weekly newsletter workflow manually or via admin/cron auth. Checks the saved newsletter settings and broadcasts automatically once the configured weekday and UTC hour have been reached.',
        auth: 'admin_jwt',
      },
      {
        id: 'admin-alerts',
        method: 'POST',
        path: '/api/admin/alerts',
        summary: 'Run scheduled alert workflow',
        description:
          'Admin-only manual trigger for the same workflow used by the 4-hour scheduled alert job: refresh the signal cache, create any new fixed/strategy alert events, and deliver up to 50 pending alert emails.',
        auth: 'admin_jwt',
      },
      {
        id: 'admin-users',
        method: 'GET',
        path: '/api/admin/users',
        summary: 'List and manage users',
        description:
          'Returns user profiles with tier, email, and admin status. Supports search queries and pagination. Also allows updating user tiers and admin flags via POST.',
        auth: 'admin_jwt',
      },
      {
        id: 'admin-newsletter',
        method: 'GET',
        path: '/api/admin/newsletter',
        summary: 'Newsletter dashboard',
        description:
          'Returns newsletter settings, subscriber counts, and issue history. Supports composing, sending, and test-sending newsletter issues via POST/PUT.',
        auth: 'admin_jwt',
      },
    ],
  },
];
