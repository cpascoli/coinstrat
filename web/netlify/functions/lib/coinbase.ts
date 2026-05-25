/**
 * Thin Coinbase Advanced Trade API client with ECDSA-JWT signing (CDP keys).
 *
 * Designed for the CQM Risk DCA bot which trades a single market (BTC-GBP)
 * with market orders and only needs a handful of endpoints:
 *   - GET  /api/v3/brokerage/accounts                       (balances)
 *   - GET  /api/v3/brokerage/products/BTC-GBP               (ticker)
 *   - POST /api/v3/brokerage/orders                          (submit market order)
 *   - GET  /api/v3/brokerage/orders/historical/{order_id}    (poll fill)
 *
 * Auth follows the CDP (Cloud Developer Platform) scheme that Coinbase now
 * issues for new API keys:
 *   - COINBASE_API_KEY     = full key name, e.g. "organizations/.../apiKeys/..."
 *   - COINBASE_API_SECRET  = EC private key in PEM form (P-256). Netlify stores
 *                            env vars as single-line strings, so multi-line
 *                            PEMs typically come in with literal "\n"
 *                            sequences. We normalize those back to real
 *                            newlines before parsing.
 *
 * Each request is signed with a short-lived (120s) ES256 JWT:
 *   header  = { alg: ES256, typ: JWT, kid: apiKey, nonce: <hex16> }
 *   payload = { sub: apiKey, iss: "cdp", nbf, exp, uri: "<METHOD> <host><path>" }
 *   sig     = ECDSA-P256-SHA256 over `${b64u(header)}.${b64u(payload)}` in JOSE
 *             (r||s) encoding, NOT DER.
 *
 * Sent as `Authorization: Bearer <jwt>`. No CB-ACCESS-* headers in this
 * scheme. Credentials are read lazily so a missing key produces a clean
 * error string rather than a startup crash.
 */
import crypto from 'crypto';

const DEFAULT_BASE = 'https://api.coinbase.com';
const JWT_VALIDITY_SECONDS = 120;

export class CoinbaseApiError extends Error {
  public readonly status: number;
  public readonly body: unknown;
  constructor(message: string, status: number, body: unknown) {
    super(message);
    this.name = 'CoinbaseApiError';
    this.status = status;
    this.body = body;
  }
}

function getCredentials(): { apiKey: string; pemKey: string; baseUrl: string } {
  const apiKey = process.env.COINBASE_API_KEY ?? '';
  const rawSecret = process.env.COINBASE_API_SECRET ?? '';
  const baseUrl = process.env.COINBASE_API_BASE ?? DEFAULT_BASE;

  if (!apiKey || !rawSecret) {
    throw new CoinbaseApiError(
      'Coinbase credentials are not configured (COINBASE_API_KEY / COINBASE_API_SECRET).',
      500,
      null,
    );
  }

  // Netlify stores env vars as single-line strings, so a multi-line PEM is
  // typically saved with literal "\n" sequences. Restore real newlines so
  // crypto.createPrivateKey() can parse the block. The replace is a no-op
  // if the value already contains real newlines.
  const pemKey = rawSecret.includes('\\n')
    ? rawSecret.replace(/\\n/g, '\n')
    : rawSecret;

  return { apiKey, pemKey, baseUrl };
}

function base64UrlEncode(input: Buffer | string): string {
  const buf = typeof input === 'string' ? Buffer.from(input) : input;
  return buf
    .toString('base64')
    .replace(/=+$/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function buildJwt(
  method: string,
  path: string,
  baseUrl: string,
  apiKey: string,
  pemKey: string,
): string {
  const host = new URL(baseUrl).host;
  const uri = `${method.toUpperCase()} ${host}${path}`;
  const now = Math.floor(Date.now() / 1000);
  const nonce = crypto.randomBytes(16).toString('hex');

  const header = {
    alg: 'ES256',
    typ: 'JWT',
    kid: apiKey,
    nonce,
  };
  const payload = {
    sub: apiKey,
    iss: 'cdp',
    nbf: now,
    exp: now + JWT_VALIDITY_SECONDS,
    uri,
  };

  const encHeader = base64UrlEncode(JSON.stringify(header));
  const encPayload = base64UrlEncode(JSON.stringify(payload));
  const signingInput = `${encHeader}.${encPayload}`;

  let privateKey: crypto.KeyObject;
  try {
    privateKey = crypto.createPrivateKey({ key: pemKey, format: 'pem' });
  } catch (err: any) {
    throw new CoinbaseApiError(
      `Failed to parse COINBASE_API_SECRET as a PEM private key: ${err?.message ?? String(err)}`,
      500,
      null,
    );
  }

  // ieee-p1363 = JOSE concat r||s (64 bytes for P-256). DER, the default,
  // would be wrong for JWS ES256.
  const signature = crypto.sign('SHA256', Buffer.from(signingInput), {
    key: privateKey,
    dsaEncoding: 'ieee-p1363',
  });
  const encSignature = base64UrlEncode(signature);

  return `${signingInput}.${encSignature}`;
}

async function request<T = unknown>(
  method: 'GET' | 'POST',
  path: string,
  body?: unknown,
  query?: Record<string, string | number | undefined>,
): Promise<T> {
  const { apiKey, pemKey, baseUrl } = getCredentials();
  const bodyText = body === undefined ? '' : JSON.stringify(body);
  // CDP JWT signs path-only; query string belongs on the URL but NOT in
  // the `uri` claim, so we sign first and then append the query.
  const jwt = buildJwt(method, path, baseUrl, apiKey, pemKey);

  const queryString = query ? buildQueryString(query) : '';

  const headers: Record<string, string> = {
    Authorization: `Bearer ${jwt}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };

  const res = await fetch(`${baseUrl}${path}${queryString}`, {
    method,
    headers,
    body: method === 'GET' ? undefined : bodyText,
  });

  const text = await res.text();
  let parsed: unknown = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }
  }

  if (!res.ok) {
    const msg = extractErrorMessage(parsed) ?? `Coinbase HTTP ${res.status}`;
    throw new CoinbaseApiError(msg, res.status, parsed);
  }

  return parsed as T;
}

function buildQueryString(query: Record<string, string | number | undefined>): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === '') continue;
    parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  }
  return parts.length === 0 ? '' : `?${parts.join('&')}`;
}

function extractErrorMessage(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null;
  const obj = body as Record<string, unknown>;
  if (typeof obj.error_response === 'object' && obj.error_response) {
    const er = obj.error_response as Record<string, unknown>;
    if (typeof er.message === 'string') return er.message;
    if (typeof er.error_details === 'string') return er.error_details;
  }
  if (typeof obj.message === 'string') return obj.message;
  if (typeof obj.error === 'string') return obj.error;
  return null;
}

/** Normalize any thrown value into a short string suitable for storage. */
export function normalizeError(err: unknown): string {
  if (err instanceof CoinbaseApiError) {
    const tail = err.body && typeof err.body === 'object'
      ? ` (${JSON.stringify(err.body).slice(0, 200)})`
      : '';
    return `${err.message}${tail}`;
  }
  if (err instanceof Error) return err.message;
  return String(err);
}

// --------------------------------------------------------------------------
// Public types (a narrow subset of the Coinbase response shapes)
// --------------------------------------------------------------------------

export interface CoinbaseAccount {
  uuid: string;
  name: string;
  currency: string;
  available_balance: { value: string; currency: string };
  hold?: { value: string; currency: string };
  type?: string;
  active?: boolean;
}

export interface CoinbaseProduct {
  product_id: string;
  price: string;
  base_increment: string;
  quote_increment: string;
  base_min_size?: string;
  quote_min_size?: string;
  status?: string;
}

export interface CoinbaseOrder {
  order_id: string;
  product_id: string;
  side: 'BUY' | 'SELL';
  status: string;                  // OPEN, FILLED, CANCELLED, FAILED, ...
  filled_size?: string;            // base (BTC) filled
  filled_value?: string;           // quote (GBP) filled
  total_fees?: string;             // GBP fees
  average_filled_price?: string;
  created_time?: string;
  completion_percentage?: string;
}

// --------------------------------------------------------------------------
// API surface
// --------------------------------------------------------------------------

/**
 * Fetch the full list of accounts across all portfolios, following the
 * cursor-based pagination Coinbase uses on this endpoint. With ?limit=250
 * (the documented max) most users fit in a single page; we still loop on
 * `has_next` + `cursor` defensively so we don't silently drop balances.
 */
export async function getAccounts(): Promise<CoinbaseAccount[]> {
  const collected: CoinbaseAccount[] = [];
  let cursor: string | undefined;
  // Defensive cap — Coinbase docs say has_next eventually goes false; this
  // just stops us from looping forever if something is misbehaving.
  for (let page = 0; page < 20; page += 1) {
    const data = await request<{
      accounts?: CoinbaseAccount[];
      has_next?: boolean;
      cursor?: string;
    }>('GET', '/api/v3/brokerage/accounts', undefined, {
      limit: 250,
      cursor,
    });
    if (data.accounts && data.accounts.length > 0) {
      collected.push(...data.accounts);
    }
    if (!data.has_next || !data.cursor) break;
    cursor = data.cursor;
  }
  return collected;
}

/**
 * Sum balances across all accounts of each currency.
 *
 * Coinbase users typically have multiple accounts per currency (one per
 * portfolio + the legacy Coinbase Wallet account + per-product subaccounts
 * created on first trade). The "balance" the admin panel cares about is
 * the total spendable across ALL of them, so we sum `available_balance` —
 * a simple `find()` would return whichever account happens to come first
 * in the response and miss the one the trade actually settled into.
 *
 * `hold` is intentionally excluded: it's funds tied up in open orders and
 * isn't immediately spendable.
 */
export async function getBtcGbpBalances(): Promise<{
  gbp: number;
  btc: number;
  rawAccounts: CoinbaseAccount[];
}> {
  const accounts = await getAccounts();
  const sumCurrency = (currency: string) =>
    accounts
      .filter((a) => a.currency?.toUpperCase() === currency)
      .reduce(
        (acc, a) => acc + (Number(a.available_balance?.value) || 0),
        0,
      );
  return {
    gbp: sumCurrency('GBP'),
    btc: sumCurrency('BTC'),
    rawAccounts: accounts,
  };
}

export async function getProduct(productId = 'BTC-GBP'): Promise<CoinbaseProduct> {
  return request<CoinbaseProduct>(
    'GET',
    `/api/v3/brokerage/products/${encodeURIComponent(productId)}`,
  );
}

/**
 * Submit a market BTC-GBP order using Coinbase's IOC market configuration.
 *  - BUY: sized by quote_size (GBP amount).
 *  - SELL: sized by base_size (BTC amount).
 *
 * `clientOrderId` is a UUID we generate per execution to give Coinbase
 * idempotency in case of retries.
 */
export async function submitMarketOrder(args: {
  clientOrderId: string;
  side: 'BUY' | 'SELL';
  productId?: string;
  quoteSize?: string;
  baseSize?: string;
}): Promise<{ success: boolean; order_id?: string; response: unknown }> {
  const { clientOrderId, side, productId = 'BTC-GBP', quoteSize, baseSize } = args;

  if (side === 'BUY' && !quoteSize) {
    throw new CoinbaseApiError('BUY orders require quoteSize (GBP).', 400, null);
  }
  if (side === 'SELL' && !baseSize) {
    throw new CoinbaseApiError('SELL orders require baseSize (BTC).', 400, null);
  }

  const marketCfg = side === 'BUY'
    ? { quote_size: quoteSize as string }
    : { base_size: baseSize as string };

  const body = {
    client_order_id: clientOrderId,
    product_id: productId,
    side,
    order_configuration: { market_market_ioc: marketCfg },
  };

  const response = await request<{
    success: boolean;
    success_response?: { order_id?: string };
    error_response?: { message?: string; error_details?: string };
  }>('POST', '/api/v3/brokerage/orders', body);

  if (response.success === false) {
    const msg = response.error_response?.message
      ?? response.error_response?.error_details
      ?? 'Coinbase rejected the order.';
    throw new CoinbaseApiError(msg, 400, response);
  }

  return {
    success: true,
    order_id: response.success_response?.order_id,
    response,
  };
}

export async function getOrder(orderId: string): Promise<CoinbaseOrder | null> {
  const data = await request<{ order?: CoinbaseOrder }>(
    'GET',
    `/api/v3/brokerage/orders/historical/${encodeURIComponent(orderId)}`,
  );
  return data.order ?? null;
}

/**
 * Poll a market order until it reaches a terminal status or we time out.
 * Market IOC orders normally fill (or fail) in <1s; this gives us a small
 * cushion for API propagation.
 */
export async function pollOrderUntilFilled(
  orderId: string,
  opts: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<CoinbaseOrder | null> {
  const timeoutMs = opts.timeoutMs ?? 6000;
  const intervalMs = opts.intervalMs ?? 400;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    let order: CoinbaseOrder | null = null;
    try {
      order = await getOrder(orderId);
    } catch {
      // Swallow transient errors during polling; we'll retry until the
      // deadline. The caller still gets a non-null result if any poll
      // succeeds.
    }
    if (order && isTerminal(order.status)) return order;
    await sleep(intervalMs);
  }

  // Final best-effort attempt to capture the latest status even if it's
  // still OPEN — the execute function persists what we have either way.
  try {
    return await getOrder(orderId);
  } catch {
    return null;
  }
}

function isTerminal(status: string | undefined): boolean {
  if (!status) return false;
  const s = status.toUpperCase();
  return s === 'FILLED' || s === 'CANCELLED' || s === 'CANCELED'
    || s === 'EXPIRED' || s === 'FAILED' || s === 'REJECTED';
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
