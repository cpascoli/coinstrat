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
  method: 'GET' | 'POST';
  path: string;
  summary: string;
  description?: string;
  auth: 'none' | 'api_key' | 'cron_secret';
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
      'Requires an API key (X-API-Key header). Available to Pro (1,000 calls/day) and Pro+ (10,000 calls/day) subscribers.',
    color: '#60a5fa',
    endpoints: [
      {
        id: 'signals-history',
        method: 'GET',
        path: '/api/v1/signals/history',
        summary: 'Full signal history',
        description:
          'Returns the complete daily signal history. Optionally filter by date range using the "from" and "to" query parameters (YYYY-MM-DD format). Includes all scores, signals, BTC price, and diagnostic fields for every day.',
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
    ],
  },
  {
    role: 'internal',
    label: 'Internal',
    description:
      'Protected by a shared CRON_SECRET. Used by the OpenClaw cron agent to refresh the signal cache and trigger the weekly digest.',
    color: '#f59e0b',
    endpoints: [
      {
        id: 'signals-refresh',
        method: 'POST',
        path: '/api/v1/signals/refresh',
        summary: 'Refresh signal cache',
        description:
          'Runs an incremental server-side refresh by default and appends any new signal rows to the Netlify Blob cache. It also accepts a precomputed signal array for manual seeding.',
        auth: 'cron_secret',
      },
      {
        id: 'weekly-digest',
        method: 'POST',
        path: '/api/email/digest',
        summary: 'Send weekly digest email',
        description:
          'Runs the weekly newsletter workflow. The daily cron checks newsletter settings, composes the issue for the current week, and broadcasts it on the configured weekday and UTC hour.',
        auth: 'cron_secret',
      },
    ],
  },
];
