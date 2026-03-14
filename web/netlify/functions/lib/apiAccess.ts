import { serviceSupabase, isPaidTier, type AppTier, type AuthenticatedProfile } from './auth';

export interface ApiRateLimitState {
  limit: number;
  remaining: number;
  resetAt: string;
}

export interface ApiEntitlementResult {
  profile: AuthenticatedProfile;
  rateLimit: ApiRateLimitState;
}

export interface ApiEntitlementError {
  statusCode: number;
  error: string;
  rateLimit?: ApiRateLimitState;
}

function nextUtcMidnight(date: Date): Date {
  return new Date(Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate() + 1,
    0,
    0,
    0,
    0,
  ));
}

export function getDailyApiLimit(tier: AppTier | string | null | undefined): number {
  switch (tier) {
    case 'pro_plus':
      return 10000;
    case 'pro':
    case 'lifetime':
      return 1000;
    default:
      return 0;
  }
}

export function buildApiRateLimitHeaders(rateLimit: ApiRateLimitState): Record<string, string> {
  return {
    'X-RateLimit-Limit': String(rateLimit.limit),
    'X-RateLimit-Remaining': String(rateLimit.remaining),
    'X-RateLimit-Reset': rateLimit.resetAt,
  };
}

export async function requirePaidApiKey(apiKey: string | null | undefined): Promise<ApiEntitlementResult | ApiEntitlementError> {
  const trimmedKey = apiKey?.trim();
  if (!trimmedKey) {
    return {
      statusCode: 401,
      error: 'Missing X-API-Key header. Upgrade to Pro for API access.',
    };
  }

  const { data: profile, error } = await serviceSupabase
    .from('profiles')
    .select('id, email, tier, is_admin, api_key, api_calls_today, api_calls_reset_at')
    .eq('api_key', trimmedKey)
    .maybeSingle();

  if (error || !profile) {
    return {
      statusCode: 403,
      error: 'Invalid API key.',
    };
  }

  if (!isPaidTier(profile.tier)) {
    return {
      statusCode: 403,
      error: 'Signal history requires a Pro subscription.',
    };
  }

  const typedProfile = profile as AuthenticatedProfile;
  const now = new Date();
  const limit = getDailyApiLimit(typedProfile.tier);
  const resetAt = typedProfile.api_calls_reset_at
    ? new Date(typedProfile.api_calls_reset_at)
    : nextUtcMidnight(now);
  const windowExpired = Number.isNaN(resetAt.getTime()) || now >= resetAt;
  const callsUsed = windowExpired ? 0 : Number(typedProfile.api_calls_today ?? 0);
  const nextCallsUsed = callsUsed + 1;
  const nextResetAt = windowExpired ? nextUtcMidnight(now) : resetAt;

  if (callsUsed >= limit) {
    return {
      statusCode: 429,
      error: `Daily rate limit exceeded (${limit} calls/day). Resets at midnight UTC.`,
      rateLimit: {
        limit,
        remaining: 0,
        resetAt: nextResetAt.toISOString(),
      },
    };
  }

  const { error: updateError } = await serviceSupabase
    .from('profiles')
    .update({
      api_calls_today: nextCallsUsed,
      api_calls_reset_at: nextResetAt.toISOString(),
    })
    .eq('id', typedProfile.id);

  if (updateError) {
    throw new Error(updateError.message);
  }

  return {
    profile: {
      ...typedProfile,
      api_calls_today: nextCallsUsed,
      api_calls_reset_at: nextResetAt.toISOString(),
    },
    rateLimit: {
      limit,
      remaining: Math.max(0, limit - nextCallsUsed),
      resetAt: nextResetAt.toISOString(),
    },
  };
}
