import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Divider,
  FormControl,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Stack,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tabs,
  TextField,
  Typography,
} from '@mui/material';
import { Activity, Banknote, LineChart as LineChartIcon, Pause, Play, RefreshCw, Save, Settings as SettingsIcon, TrendingUp } from 'lucide-react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  CQM_DEFAULT_BTC_SELL_FRACTION,
  CQM_DEFAULT_MAX_CASH_FRACTION,
  CQM_DEFAULT_SELL_THRESHOLD,
  CQM_FAIR_RISK,
} from '../../utils/cqmSizing';

/**
 * CQM Risk DCA Bot admin panel (`/bot`).
 *
 * Three Paper sections:
 *   1. Bot Status (balances, live Risk, computed target, Execute button).
 *   2. Strategy Settings (base GBP, frequency, save).
 *   3. Order History + Stats (filled orders table + aggregated KPIs).
 *
 * All data comes from the four admin-gated Netlify functions under
 * /api/admin/cqm-bot/*. The Execute action opens a confirmation Dialog
 * showing the exact target before any trade is sent.
 */

type Frequency = 'daily' | 'weekly' | 'monthly';

interface StatusResponse {
  settings: { base_amount_gbp: number; frequency: Frequency; enabled: boolean };
  balances: { gbp: number; btc: number } | null;
  product: { product_id: string; price: number | null } | null;
  risk: { value: number; signal_date: string; btc_usd: number } | null;
  target: {
    side: 'BUY' | 'SELL' | 'NONE';
    amount_gbp: number;
    signed_gbp: number;
    estimated_btc_size: number | null;
  } | null;
  virtual_ledger: {
    cash_gbp: number;
    btc_held: number;
    deposits_gbp: number;
    buys_gbp: number;
    sells_gbp: number;
    periods_accrued: number;
  } | null;
  frequency_guard: {
    can_execute: boolean;
    next_slot_at: string | null;
    last_triggered_at: string | null;
    guard_reason: string | null;
  };
  last_order: any | null;
  partial_errors: Record<string, string> | null;
}

interface OrdersResponse {
  orders: Array<{
    id: string;
    triggered_at: string;
    side: 'BUY' | 'SELL';
    cqm_risk: number;
    base_amount_gbp: number;
    target_amount_gbp: number;
    btc_gbp_ref: number;
    base_filled: number | null;
    quote_filled: number | null;
    fees_gbp: number | null;
    coinbase_order_id: string | null;
    coinbase_status: string;
    error_summary: string | null;
  }>;
  stats: {
    filled_count: number;
    total_bought_gbp: number;
    total_sold_gbp: number;
    total_fees_gbp: number;
    btc_accumulated: number;
    gross_invested_gbp: number;
    realized_proceeds_gbp: number;
    net_invested_gbp: number;
    current_btc_gbp: number | null;
    bot_btc_value_gbp: number | null;
    bot_portfolio_value_gbp: number | null;
    bot_roi_pct: number | null;
  };
  partial_errors: Record<string, string> | null;
}

interface CqmBotTabProps {
  authHeaders: () => Record<string, string>;
}

const SIDE_COLORS: Record<string, string> = {
  BUY: '#22c55e',
  SELL: '#ef4444',
  NONE: '#94a3b8',
};

const STATUS_COLORS: Record<string, string> = {
  filled: '#22c55e',
  submitted: '#60a5fa',
  open: '#60a5fa',
  pending: '#facc15',
  failed: '#ef4444',
  cancelled: '#94a3b8',
};

/** Fixed GBP→USD rate for displaying execution prices in the order table. */
const GBP_TO_USD = 1.33;

/** Effective BTC/GBP from fill amounts, converted to USD at 1 GBP = 1.33 USD. */
function orderExecutionBtcUsd(order: OrdersResponse['orders'][number]): number | null {
  const base = order.base_filled != null ? Number(order.base_filled) : 0;
  const quote = order.quote_filled != null ? Number(order.quote_filled) : 0;
  if (base > 0 && quote > 0) {
    return (quote / base) * GBP_TO_USD;
  }
  return null;
}

const CqmBotTab: React.FC<CqmBotTabProps> = ({ authHeaders }) => {
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [orders, setOrders] = useState<OrdersResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [baseAmount, setBaseAmount] = useState<string>('100');
  const [frequency, setFrequency] = useState<Frequency>('daily');
  const [savingSettings, setSavingSettings] = useState(false);
  const [settingsMessage, setSettingsMessage] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [chartTab, setChartTab] = useState(0);

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [executeMessage, setExecuteMessage] = useState<
    { severity: 'success' | 'error'; text: string } | null
  >(null);
  const [togglingEnabled, setTogglingEnabled] = useState(false);

  const loadAll = useCallback(async () => {
    setError(null);
    try {
      const [s, o] = await Promise.all([
        fetch('/api/admin/cqm-bot/status', { headers: authHeaders() }).then((r) => r.json()),
        fetch('/api/admin/cqm-bot/orders', { headers: authHeaders() }).then((r) => r.json()),
      ]);
      if (s.error) throw new Error(s.error);
      if (o.error) throw new Error(o.error);
      setStatus(s);
      setOrders(o);
      setBaseAmount(String(s.settings.base_amount_gbp));
      setFrequency(s.settings.frequency);
    } catch (err: any) {
      setError(err?.message ?? 'Failed to load CQM bot data');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [authHeaders]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const handleRefresh = useCallback(() => {
    setRefreshing(true);
    loadAll();
  }, [loadAll]);

  const handleSaveSettings = useCallback(async () => {
    setSettingsMessage(null);
    setSavingSettings(true);
    try {
      const res = await fetch('/api/admin/cqm-bot/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({
          base_amount_gbp: Number(baseAmount),
          frequency,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Failed to save settings');
      setSettingsMessage('Strategy settings saved.');
      await loadAll();
      setSettingsOpen(false);
    } catch (err: any) {
      setSettingsMessage(err?.message ?? 'Failed to save settings');
    } finally {
      setSavingSettings(false);
    }
  }, [authHeaders, baseAmount, frequency, loadAll]);

  const handleTogglePause = useCallback(async () => {
    if (!status) return;
    const nextEnabled = !status.settings.enabled;
    setTogglingEnabled(true);
    setExecuteMessage(null);
    try {
      const res = await fetch('/api/admin/cqm-bot/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ enabled: nextEnabled }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Failed to toggle bot state');
      await loadAll();
    } catch (err: any) {
      setExecuteMessage({ severity: 'error', text: err?.message ?? 'Failed to toggle bot state' });
    } finally {
      setTogglingEnabled(false);
    }
  }, [authHeaders, loadAll, status]);

  const handleExecute = useCallback(async () => {
    setExecuting(true);
    setExecuteMessage(null);
    try {
      const res = await fetch('/api/admin/cqm-bot/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ confirm: true }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Execute failed');
      const o = data.order;
      const fillSummary = o?.coinbase_status === 'filled'
        ? `Filled ${Number(o.base_filled).toFixed(8)} BTC for £${Number(o.quote_filled).toFixed(2)}.`
        : `Order ${o?.coinbase_status ?? 'submitted'} (id ${o?.coinbase_order_id ?? '—'}).`;
      setExecuteMessage({ severity: 'success', text: `Market ${o?.side} placed. ${fillSummary}` });
      setConfirmOpen(false);
      await loadAll();
    } catch (err: any) {
      setExecuteMessage({ severity: 'error', text: err?.message ?? 'Execute failed' });
    } finally {
      setExecuting(false);
    }
  }, [authHeaders, loadAll]);

  // Bot Status panel always uses live Coinbase totals (you still want to
  // see your full Coinbase balances at the top). The bottom Cumulative
  // Stats panel uses bot-only numbers from cqm_bot_orders.
  const balances = status?.balances ?? null;
  const btcGbp = status?.product?.price ?? orders?.stats.current_btc_gbp ?? null;
  const btcValueGbp = balances && btcGbp ? balances.btc * btcGbp : null;

  /**
   * Mirrors computeCqmDynamicTrade so the panel can explain *why* the target
   * is what it is. The displayed amount itself always comes from the server.
   */
  const sizing = useMemo(() => {
    if (!status?.risk || !status.virtual_ledger) return null;
    const r = status.risk.value;
    const base = status.settings.base_amount_gbp;
    const cash = status.virtual_ledger.cash_gbp;
    const btcHeld = status.virtual_ledger.btc_held;
    const price = status.product?.price ?? null;

    if (r < CQM_FAIR_RISK) {
      const taper = (CQM_FAIR_RISK - r) / CQM_FAIR_RISK;
      const cashPct = CQM_DEFAULT_MAX_CASH_FRACTION * taper;
      const baseLeg = Math.max(0, base * (1 - 2 * r));
      const cashLeg = cashPct * cash;
      return { kind: 'buy' as const, taper, cashPct, baseLeg, cashLeg, cash };
    }
    if (r > CQM_DEFAULT_SELL_THRESHOLD) {
      const btcValue = price != null ? btcHeld * price : null;
      const sellScale = (r - CQM_DEFAULT_SELL_THRESHOLD) / (1 - CQM_DEFAULT_SELL_THRESHOLD);
      const size = btcValue != null
        ? Math.max(base, CQM_DEFAULT_BTC_SELL_FRACTION * btcValue)
        : base;
      return { kind: 'sell' as const, sellScale, size, btcValue };
    }
    return { kind: 'hold' as const };
  }, [status]);

  /**
   * Equity curve derived purely from the bot's filled orders, marked-to-market
   * at each order's BTC-GBP reference price (the only price we know at each
   * fill) and a final point at the current price. The bot is treated as a
   * closed account: gross invested in, BTC accumulated, realized cash from
   * sells. Drawdown uses the value÷invested ratio so ongoing DCA inflows don't
   * mask loss periods (same methodology as the backtest's return drawdown).
   */
  const equityCurve = useMemo(() => {
    if (!orders) return [];
    const filled = orders.orders
      .filter((o) => o.coinbase_status === 'filled')
      .slice()
      .sort((a, b) => new Date(a.triggered_at).getTime() - new Date(b.triggered_at).getTime());
    if (filled.length === 0) return [];

    let btc = 0;
    let gross = 0;
    let realized = 0;
    let peakRatio = -Infinity;
    let lastPrice = 0;

    const points: Array<{
      ts: number;
      invested: number;
      portfolio: number;
      pnl: number;
      pnlPct: number;
      drawdownPct: number;
    }> = [];

    const pushPoint = (ts: number, price: number) => {
      const markPrice = Number.isFinite(price) && price > 0 ? price : lastPrice;
      if (markPrice > 0) lastPrice = markPrice;
      const portfolio = btc * markPrice + realized;
      const pnl = portfolio - gross;
      const pnlPct = gross > 0 ? (pnl / gross) * 100 : 0;
      const ratio = gross > 0 ? portfolio / gross : 1;
      if (ratio > peakRatio) peakRatio = ratio;
      const drawdownPct = peakRatio > 0 ? ((ratio - peakRatio) / peakRatio) * 100 : 0;
      points.push({ ts, invested: gross, portfolio, pnl, pnlPct, drawdownPct });
    };

    for (const o of filled) {
      const base = o.base_filled != null ? Number(o.base_filled) : 0;
      const quote = o.quote_filled != null ? Number(o.quote_filled) : 0;
      const fees = o.fees_gbp != null ? Number(o.fees_gbp) : 0;
      if (o.side === 'BUY') {
        gross += quote + fees;
        btc += base;
      } else {
        realized += quote - fees;
        btc -= base;
      }
      pushPoint(new Date(o.triggered_at).getTime(), Number(o.btc_gbp_ref));
    }

    const todayPrice = orders.stats.current_btc_gbp;
    if (todayPrice != null && todayPrice > 0) {
      pushPoint(Date.now(), todayPrice);
    }

    return points;
  }, [orders]);

  const maxDrawdownPct = useMemo(
    () => (equityCurve.length ? Math.min(...equityCurve.map((p) => p.drawdownPct)) : 0),
    [equityCurve],
  );

  const targetHeadline = useMemo(() => {
    if (!status?.target) return null;
    const tgt = status.target;
    if (tgt.side === 'NONE') return 'No trade (hold)';
    return `${tgt.side} £${tgt.amount_gbp.toFixed(2)}`;
  }, [status]);

  if (loading) {
    return (
      <Paper sx={{ p: 4, textAlign: 'center' }}>
        <CircularProgress size={28} sx={{ mb: 2 }} />
        <Typography variant="body2" color="text.secondary">Loading CQM bot…</Typography>
      </Paper>
    );
  }

  return (
    <Stack spacing={2.5}>
      {error && <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>}
      {status?.partial_errors && (
        <Alert severity="warning">
          Some live data could not be fetched from Coinbase: {Object.entries(status.partial_errors).map(([k, v]) => `${k}: ${v}`).join(' · ')}
        </Alert>
      )}

      {/* --- Cumulative Stats -------------------------------------------- */}
      <Paper sx={{ p: 2.5 }}>
        <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 0.5 }}>
          <TrendingUp size={18} />
          <Typography variant="subtitle1" sx={{ fontWeight: 800 }}>Cumulative Stats</Typography>
        </Stack>
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.5 }}>
          Computed purely from this bot's filled orders. Coinbase balances and other holdings on your account are NOT included.
        </Typography>

        <Stack direction="row" spacing={2} useFlexGap flexWrap="wrap">
          <StatTile
            label="BTC accumulated"
            value={orders ? orders.stats.btc_accumulated.toFixed(8) : '—'}
            color="#f59e0b"
            sub={orders?.stats.bot_btc_value_gbp != null ? `≈ £${orders.stats.bot_btc_value_gbp.toFixed(2)}` : undefined}
          />
          <StatTile
            label="Gross invested"
            value={orders ? `£${orders.stats.gross_invested_gbp.toFixed(2)}` : '—'}
            color="#22c55e"
            sub={orders ? `bought £${orders.stats.total_bought_gbp.toFixed(2)} + £${orders.stats.total_fees_gbp.toFixed(2)} fees` : undefined}
          />
          <StatTile
            label="Realized proceeds"
            value={orders ? `£${orders.stats.realized_proceeds_gbp.toFixed(2)}` : '—'}
            color="#ef4444"
            sub={orders ? `sold £${orders.stats.total_sold_gbp.toFixed(2)} net of fees` : undefined}
          />
          <StatTile
            label="Net invested"
            value={orders ? `£${orders.stats.net_invested_gbp.toFixed(2)}` : '—'}
            color="#60a5fa"
            sub="gross − realized"
          />
          <StatTile
            label="Bot portfolio value"
            value={orders?.stats.bot_portfolio_value_gbp != null ? `£${orders.stats.bot_portfolio_value_gbp.toFixed(2)}` : '—'}
            color="#a78bfa"
            sub="BTC held + cash banked"
          />
          <StatTile
            label="ROI"
            value={orders?.stats.bot_roi_pct != null ? `${(orders.stats.bot_roi_pct * 100).toFixed(2)}%` : '—'}
            color={(orders?.stats.bot_roi_pct ?? 0) >= 0 ? '#22c55e' : '#ef4444'}
            sub="vs. gross invested"
          />
        </Stack>
      </Paper>

      {/* --- Bot Status -------------------------------------------------- */}
      <Paper sx={{ p: 2.5 }}>
        <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1.5 }} useFlexGap flexWrap="wrap">
          <Stack direction="row" alignItems="center" spacing={1} useFlexGap flexWrap="wrap">
            <Activity size={18} />
            <Typography variant="subtitle1" sx={{ fontWeight: 800 }}>Bot Status</Typography>
            <Chip
              size="small"
              label={status?.balances ? 'Coinbase connected' : 'Coinbase unreachable'}
              sx={{
                fontWeight: 700,
                bgcolor: status?.balances ? 'rgba(34,197,94,0.14)' : 'rgba(239,68,68,0.14)',
                color: status?.balances ? '#22c55e' : '#ef4444',
              }}
            />
            <Chip
              size="small"
              label={status?.settings.enabled ? 'Strategy active' : 'Strategy paused'}
              sx={{
                fontWeight: 700,
                bgcolor: status?.settings.enabled ? 'rgba(34,197,94,0.14)' : 'rgba(245,158,11,0.14)',
                color: status?.settings.enabled ? '#22c55e' : '#f59e0b',
              }}
            />
          </Stack>
          <Stack direction="row" alignItems="center" spacing={1}>
            <Button
              size="small"
              variant="outlined"
              color={status?.settings.enabled ? 'warning' : 'success'}
              onClick={handleTogglePause}
              disabled={!status || togglingEnabled}
              startIcon={
                togglingEnabled
                  ? <CircularProgress size={14} color="inherit" />
                  : status?.settings.enabled
                    ? <Pause size={14} />
                    : <Play size={14} />
              }
              sx={{ textTransform: 'none', fontWeight: 700 }}
              title={
                status?.settings.enabled
                  ? 'Pause the strategy — blocks any further trade execution until resumed'
                  : 'Resume the strategy — re-enables trade execution subject to the frequency guard'
              }
            >
              {status?.settings.enabled ? 'Pause' : 'Resume'}
            </Button>
            <Button
              size="small"
              variant="outlined"
              color="inherit"
              onClick={() => { setSettingsMessage(null); setSettingsOpen(true); }}
              disabled={!status}
              startIcon={<SettingsIcon size={14} />}
              sx={{ textTransform: 'none', fontWeight: 700 }}
              title="Edit strategy settings (base amount, frequency)"
            >
              Settings
            </Button>
            <Button
              size="small"
              variant="outlined"
              onClick={handleRefresh}
              disabled={refreshing}
              startIcon={refreshing ? <CircularProgress size={14} /> : <RefreshCw size={14} />}
              sx={{ textTransform: 'none', fontWeight: 700 }}
            >
              Refresh
            </Button>
          </Stack>
        </Stack>

        <Stack direction={{ xs: 'column', md: 'row' }} spacing={3} useFlexGap flexWrap="wrap" sx={{ mb: 2 }}>
          <KV label="GBP balance" value={balances?.gbp != null ? `£${balances.gbp.toFixed(2)}` : '—'} />
          <KV
            label="BTC balance"
            value={balances?.btc != null
              ? `${balances.btc.toFixed(8)} (≈ £${btcValueGbp != null ? btcValueGbp.toFixed(2) : '—'})`
              : '—'}
          />
          <KV label="BTC-GBP price" value={btcGbp != null ? `£${btcGbp.toLocaleString()}` : '—'} />
          <KV
            label="CQM Risk"
            value={status?.risk ? `${(status.risk.value * 100).toFixed(2)}%` : '—'}
            sub={status?.risk?.signal_date ? `signal date ${status.risk.signal_date}` : undefined}
          />
          <KV
            label="Strategy cash (ledger)"
            value={status?.virtual_ledger ? `£${status.virtual_ledger.cash_gbp.toFixed(2)}` : '—'}
            sub={status?.virtual_ledger
              ? `£${status.virtual_ledger.deposits_gbp.toFixed(0)} deposited over ${status.virtual_ledger.periods_accrued} slots`
              : undefined}
          />
          <KV
            label="Strategy BTC (ledger)"
            value={status?.virtual_ledger ? status.virtual_ledger.btc_held.toFixed(8) : '—'}
            sub={status?.virtual_ledger && btcGbp != null
              ? `≈ £${(status.virtual_ledger.btc_held * btcGbp).toFixed(2)}`
              : undefined}
          />
        </Stack>

        <Divider sx={{ mb: 2 }} />

        <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} alignItems={{ md: 'center' }} justifyContent="space-between">
          <Box>
            <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600 }}>
              Target trade (today)
            </Typography>
            <Stack direction="row" alignItems="center" spacing={1.5}>
              <Typography variant="h6" sx={{ fontWeight: 800, fontFamily: 'monospace' }}>
                {targetHeadline ?? '—'}
              </Typography>
              {status?.target && (
                <Chip
                  size="small"
                  label={status.target.side}
                  sx={{
                    fontWeight: 800,
                    bgcolor: `${SIDE_COLORS[status.target.side]}22`,
                    color: SIDE_COLORS[status.target.side],
                  }}
                />
              )}
            </Stack>
            {sizing?.kind === 'buy' && status?.risk && (
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', fontFamily: 'monospace' }}>
                buy = max(base leg, cash leg), capped at strategy cash
                <br />
                base leg £{sizing.baseLeg.toFixed(2)} = £{status.settings.base_amount_gbp.toFixed(0)} × (1 − 2 × {(status.risk.value * 100).toFixed(1)}%)
                <br />
                cash leg £{sizing.cashLeg.toFixed(2)} = {(sizing.cashPct * 100).toFixed(2)}% of £{sizing.cash.toFixed(2)} cash
                ({(CQM_DEFAULT_MAX_CASH_FRACTION * 100).toFixed(0)}% × taper {(sizing.taper * 100).toFixed(0)}%)
              </Typography>
            )}
            {sizing?.kind === 'sell' && status?.risk && (
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', fontFamily: 'monospace' }}>
                sell = max(base, {(CQM_DEFAULT_BTC_SELL_FRACTION * 100).toFixed(0)}% of BTC value{sizing.btcValue != null ? ` £${sizing.btcValue.toFixed(2)}` : ''})
                × scale {(sizing.sellScale * 100).toFixed(0)}%, capped at BTC held
                <br />
                scale = (Risk {(status.risk.value * 100).toFixed(1)}% − {(CQM_DEFAULT_SELL_THRESHOLD * 100).toFixed(0)}%) / {(100 - CQM_DEFAULT_SELL_THRESHOLD * 100).toFixed(0)}%
              </Typography>
            )}
            {sizing?.kind === 'hold' && status?.risk && (
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', fontFamily: 'monospace' }}>
                hold zone: {(CQM_FAIR_RISK * 100).toFixed(0)}% ≤ Risk {(status.risk.value * 100).toFixed(1)}% ≤ {(CQM_DEFAULT_SELL_THRESHOLD * 100).toFixed(0)}% — no buy or sell
              </Typography>
            )}
            {status?.target?.side === 'SELL' && status.target.estimated_btc_size != null && (
              <Typography variant="caption" color="text.secondary">
                Estimated BTC to sell: {status.target.estimated_btc_size.toFixed(8)}
              </Typography>
            )}
          </Box>

          <Box sx={{ minWidth: 240 }}>
            <Button
              fullWidth
              variant="contained"
              color={status?.target?.side === 'SELL' ? 'error' : 'success'}
              startIcon={<Play size={16} />}
              disabled={!status?.frequency_guard?.can_execute || executing}
              onClick={() => setConfirmOpen(true)}
              sx={{ textTransform: 'none', fontWeight: 800 }}
            >
              {status?.target?.side === 'NONE' ? 'No trade due' : `Execute ${status?.target?.side ?? ''} trade`}
            </Button>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
              {status?.frequency_guard?.guard_reason ?? 'Ready for trade.'}
              {status?.frequency_guard?.next_slot_at && !status.frequency_guard.can_execute && (
                <> Next slot: {new Date(status.frequency_guard.next_slot_at).toLocaleString()}.</>
              )}
            </Typography>
          </Box>
        </Stack>

        {executeMessage && (
          <Alert sx={{ mt: 2 }} severity={executeMessage.severity} onClose={() => setExecuteMessage(null)}>
            {executeMessage.text}
          </Alert>
        )}
      </Paper>

      {/* --- Performance (tabbed charts derived from orders) ------------- */}
      <Paper sx={{ p: 2.5 }}>
        <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 0.5 }}>
          <LineChartIcon size={18} />
          <Typography variant="subtitle1" sx={{ fontWeight: 800 }}>Performance</Typography>
        </Stack>
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
          Derived from this bot's filled orders, marked at each fill's BTC-GBP reference price.
          Drawdown is measured on the value ÷ invested ratio, so ongoing deposits don't mask loss periods.
        </Typography>

        {equityCurve.length === 0 ? (
          <Typography variant="body2" color="text.secondary" sx={{ py: 3, textAlign: 'center' }}>
            No filled orders yet. Charts appear once the bot has executed at least one trade.
          </Typography>
        ) : (
          <>
            <Tabs
              value={chartTab}
              onChange={(_e, v) => setChartTab(v)}
              sx={{ minHeight: 36, mb: 1, '& .MuiTab-root': { minHeight: 36, textTransform: 'none', fontWeight: 700 } }}
            >
              <Tab label="ROI" />
              <Tab label="Profit & Loss" />
              <Tab label="Drawdown" />
            </Tabs>

            {chartTab === 0 && (
              <Box>
                <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mb: 1 }}>
                  Return on gross invested capital over time
                  {orders?.stats.bot_roi_pct != null && <> · now {(orders.stats.bot_roi_pct * 100).toFixed(2)}%</>}
                </Typography>
                <Box sx={{ height: { xs: 260, sm: 320 }, width: '100%', minWidth: 0 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={equityCurve} margin={{ top: 5, right: 16, left: 6, bottom: 5 }}>
                      <defs>
                        <linearGradient id="roiFill" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#22c55e" stopOpacity={0.4} />
                          <stop offset="100%" stopColor="#22c55e" stopOpacity={0.03} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.15)" />
                      <XAxis
                        dataKey="ts"
                        type="number"
                        scale="time"
                        domain={['dataMin', 'dataMax']}
                        tickFormatter={fmtChartDate}
                        tick={{ fontSize: 11, fill: '#94a3b8' }}
                        minTickGap={40}
                      />
                      <YAxis
                        tickFormatter={(v) => `${Number(v).toFixed(0)}%`}
                        tick={{ fontSize: 11, fill: '#94a3b8' }}
                        width={48}
                      />
                      <Tooltip content={<RoiTooltip />} />
                      <ReferenceLine y={0} stroke="#94a3b8" strokeWidth={1} />
                      <Area type="monotone" dataKey="pnlPct" name="ROI" stroke="#22c55e" strokeWidth={2} fill="url(#roiFill)" />
                    </AreaChart>
                  </ResponsiveContainer>
                </Box>
              </Box>
            )}

            {chartTab === 1 && (
              <Box>
                <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mb: 1 }}>
                  Portfolio value vs gross invested — the gap is profit &amp; loss
                </Typography>
                <Box sx={{ height: { xs: 260, sm: 320 }, width: '100%', minWidth: 0 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={equityCurve} margin={{ top: 5, right: 16, left: 6, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.15)" />
                      <XAxis
                        dataKey="ts"
                        type="number"
                        scale="time"
                        domain={['dataMin', 'dataMax']}
                        tickFormatter={fmtChartDate}
                        tick={{ fontSize: 11, fill: '#94a3b8' }}
                        minTickGap={40}
                      />
                      <YAxis
                        tickFormatter={(v) => `£${Number(v).toLocaleString()}`}
                        tick={{ fontSize: 11, fill: '#94a3b8' }}
                        width={72}
                      />
                      <Tooltip content={<PnlTooltip />} />
                      <Line type="monotone" dataKey="invested" name="Invested" stroke="#60a5fa" strokeWidth={2} dot={false} />
                      <Line type="monotone" dataKey="portfolio" name="Portfolio" stroke="#22c55e" strokeWidth={2} dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </Box>
              </Box>
            )}

            {chartTab === 2 && (
              <Box>
                <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mb: 1 }}>
                  Decline from the high-water mark · max {maxDrawdownPct.toFixed(1)}%
                </Typography>
                <Box sx={{ height: { xs: 260, sm: 320 }, width: '100%', minWidth: 0 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={equityCurve} margin={{ top: 5, right: 16, left: 6, bottom: 5 }}>
                      <defs>
                        <linearGradient id="ddFill" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#ef4444" stopOpacity={0.05} />
                          <stop offset="100%" stopColor="#ef4444" stopOpacity={0.45} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.15)" />
                      <XAxis
                        dataKey="ts"
                        type="number"
                        scale="time"
                        domain={['dataMin', 'dataMax']}
                        tickFormatter={fmtChartDate}
                        tick={{ fontSize: 11, fill: '#94a3b8' }}
                        minTickGap={40}
                      />
                      <YAxis
                        tickFormatter={(v) => `${Number(v).toFixed(0)}%`}
                        tick={{ fontSize: 11, fill: '#94a3b8' }}
                        width={48}
                        domain={['dataMin', 0]}
                      />
                      <Tooltip content={<DrawdownTooltip />} />
                      <ReferenceLine y={0} stroke="#94a3b8" strokeWidth={1} />
                      <Area type="monotone" dataKey="drawdownPct" name="Drawdown" stroke="#ef4444" strokeWidth={2} fill="url(#ddFill)" />
                    </AreaChart>
                  </ResponsiveContainer>
                </Box>
              </Box>
            )}
          </>
        )}
      </Paper>

      {/* --- Order History ----------------------------------------------- */}
      <Paper sx={{ p: 2.5 }}>
        <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1.5 }}>
          <Banknote size={18} />
          <Typography variant="subtitle1" sx={{ fontWeight: 800 }}>Order History</Typography>
          <Chip size="small" variant="outlined" label={`${orders?.orders.length ?? 0} orders · ${orders?.stats.filled_count ?? 0} filled`} />
        </Stack>

        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell sx={{ fontWeight: 700 }}>Triggered</TableCell>
                <TableCell sx={{ fontWeight: 700 }}>Side</TableCell>
                <TableCell align="right" sx={{ fontWeight: 700 }}>Risk %</TableCell>
                <TableCell align="right" sx={{ fontWeight: 700 }}>Target £</TableCell>
                <TableCell align="right" sx={{ fontWeight: 700 }}>BTC filled</TableCell>
                <TableCell align="right" sx={{ fontWeight: 700 }}>GBP filled</TableCell>
                <TableCell align="right" sx={{ fontWeight: 700 }}>BTC USD</TableCell>
                <TableCell align="right" sx={{ fontWeight: 700 }}>Fees £</TableCell>
                <TableCell sx={{ fontWeight: 700 }}>Status</TableCell>
                <TableCell sx={{ fontWeight: 700 }}>Coinbase id</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {(orders?.orders ?? []).length === 0 ? (
                <TableRow>
                  <TableCell colSpan={10} align="center" sx={{ color: 'text.secondary', py: 3 }}>
                    No orders yet. Execute a trade to populate this table.
                  </TableCell>
                </TableRow>
              ) : (
                orders!.orders.map((o) => {
                  const execBtcUsd = orderExecutionBtcUsd(o);
                  return (
                  <TableRow key={o.id} hover>
                    <TableCell>
                      <Typography variant="caption" sx={{ fontFamily: 'monospace' }}>
                        {new Date(o.triggered_at).toLocaleString()}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Chip
                        size="small"
                        label={o.side}
                        sx={{
                          fontWeight: 800,
                          bgcolor: `${SIDE_COLORS[o.side]}22`,
                          color: SIDE_COLORS[o.side],
                        }}
                      />
                    </TableCell>
                    <TableCell align="right" sx={{ fontFamily: 'monospace' }}>
                      {(Number(o.cqm_risk) * 100).toFixed(2)}%
                    </TableCell>
                    <TableCell align="right" sx={{ fontFamily: 'monospace' }}>
                      £{Number(o.target_amount_gbp).toFixed(2)}
                    </TableCell>
                    <TableCell align="right" sx={{ fontFamily: 'monospace' }}>
                      {o.base_filled != null ? Number(o.base_filled).toFixed(8) : '—'}
                    </TableCell>
                    <TableCell align="right" sx={{ fontFamily: 'monospace' }}>
                      {o.quote_filled != null ? `£${Number(o.quote_filled).toFixed(2)}` : '—'}
                    </TableCell>
                    <TableCell align="right" sx={{ fontFamily: 'monospace' }}>
                      {execBtcUsd != null
                        ? `$${execBtcUsd.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
                        : '—'}
                    </TableCell>
                    <TableCell align="right" sx={{ fontFamily: 'monospace' }}>
                      {o.fees_gbp != null ? `£${Number(o.fees_gbp).toFixed(2)}` : '—'}
                    </TableCell>
                    <TableCell>
                      <Chip
                        size="small"
                        label={o.coinbase_status}
                        sx={{
                          fontSize: 11,
                          fontWeight: 700,
                          bgcolor: `${STATUS_COLORS[o.coinbase_status] ?? '#94a3b8'}22`,
                          color: STATUS_COLORS[o.coinbase_status] ?? '#94a3b8',
                        }}
                        title={o.error_summary ?? ''}
                      />
                    </TableCell>
                    <TableCell>
                      <Typography variant="caption" sx={{ fontFamily: 'monospace', color: 'text.secondary' }}>
                        {o.coinbase_order_id ? `${o.coinbase_order_id.slice(0, 12)}…` : '—'}
                      </Typography>
                    </TableCell>
                  </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>

      {/* --- Confirmation Dialog ----------------------------------------- */}
      <Dialog open={confirmOpen} onClose={() => !executing && setConfirmOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ fontWeight: 800 }}>
          Confirm market {status?.target?.side ?? ''} on Coinbase
        </DialogTitle>
        <DialogContent>
          <DialogContentText sx={{ mb: 2 }}>
            This will submit a real market order on the BTC-GBP market with your Coinbase account.
          </DialogContentText>
          <Stack spacing={1}>
            <KV label="Side" value={status?.target?.side ?? '—'} mono />
            <KV
              label="Target amount"
              value={status?.target ? `£${status.target.amount_gbp.toFixed(2)}` : '—'}
              mono
            />
            <KV
              label="Reference BTC-GBP"
              value={btcGbp != null ? `£${btcGbp.toLocaleString()}` : '—'}
              mono
            />
            <KV
              label="Strategy cash (ledger)"
              value={status?.virtual_ledger ? `£${status.virtual_ledger.cash_gbp.toFixed(2)}` : '—'}
              mono
            />
            {status?.target?.side === 'SELL' && status.target.estimated_btc_size != null && (
              <KV
                label="Estimated BTC to sell"
                value={status.target.estimated_btc_size.toFixed(8)}
                mono
              />
            )}
            <KV
              label="CQM Risk"
              value={status?.risk ? `${(status.risk.value * 100).toFixed(2)}%` : '—'}
              mono
            />
            <KV
              label="Signal date"
              value={status?.risk?.signal_date ?? '—'}
              mono
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmOpen(false)} disabled={executing} sx={{ textTransform: 'none' }}>
            Cancel
          </Button>
          <Button
            variant="contained"
            color={status?.target?.side === 'SELL' ? 'error' : 'success'}
            disabled={executing}
            startIcon={executing ? <CircularProgress size={14} color="inherit" /> : <Play size={14} />}
            onClick={handleExecute}
            sx={{ textTransform: 'none', fontWeight: 800 }}
          >
            {executing ? 'Submitting…' : 'Confirm market order'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* --- Strategy Settings Dialog ------------------------------------ */}
      <Dialog open={settingsOpen} onClose={() => !savingSettings && setSettingsOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ fontWeight: 800 }}>
          <Stack direction="row" alignItems="center" spacing={1}>
            <SettingsIcon size={18} />
            <span>Strategy Settings</span>
          </Stack>
        </DialogTitle>
        <DialogContent>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems={{ sm: 'flex-end' }} sx={{ mt: 1 }}>
            <TextField
              label="Base amount (GBP)"
              size="small"
              type="number"
              inputProps={{ min: 0, step: 1 }}
              value={baseAmount}
              onChange={(e) => setBaseAmount(e.target.value)}
              sx={{ maxWidth: 200 }}
            />
            <FormControl size="small" sx={{ minWidth: 160 }}>
              <InputLabel id="cqm-bot-frequency">Frequency</InputLabel>
              <Select
                labelId="cqm-bot-frequency"
                label="Frequency"
                value={frequency}
                onChange={(e) => setFrequency(e.target.value as Frequency)}
              >
                <MenuItem value="daily">Daily</MenuItem>
                <MenuItem value="weekly">Weekly</MenuItem>
                <MenuItem value="monthly">Monthly</MenuItem>
              </Select>
            </FormControl>
          </Stack>

          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 2, fontFamily: 'monospace' }}>
            Dynamic sizing on the strategy's virtual ledger (deposits + own orders, not exchange balances):
            <br />
            Risk &lt; {(CQM_FAIR_RISK * 100).toFixed(0)}% → BUY max(base × (1 − 2 × Risk), {(CQM_DEFAULT_MAX_CASH_FRACTION * 100).toFixed(0)}% × taper × cash), capped at cash
            <br />
            {(CQM_FAIR_RISK * 100).toFixed(0)}–{(CQM_DEFAULT_SELL_THRESHOLD * 100).toFixed(0)}% → HOLD ·
            Risk &gt; {(CQM_DEFAULT_SELL_THRESHOLD * 100).toFixed(0)}% → SELL max(base, {(CQM_DEFAULT_BTC_SELL_FRACTION * 100).toFixed(0)}% of BTC) × scale, capped at BTC held ·
            skip when &lt; £1
          </Typography>

          {settingsMessage && (
            <Alert sx={{ mt: 2 }} severity="info" onClose={() => setSettingsMessage(null)}>{settingsMessage}</Alert>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSettingsOpen(false)} disabled={savingSettings} sx={{ textTransform: 'none' }}>
            Cancel
          </Button>
          <Button
            variant="contained"
            startIcon={savingSettings ? <CircularProgress size={14} color="inherit" /> : <Save size={14} />}
            onClick={handleSaveSettings}
            disabled={savingSettings || !Number(baseAmount)}
            sx={{ textTransform: 'none', fontWeight: 700 }}
          >
            Save settings
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
};

function fmtChartDate(ts: number): string {
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function fmtGbp(value: number): string {
  return `${value < 0 ? '−' : ''}£${Math.abs(value).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

const TooltipCard: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <Box sx={{ bgcolor: 'rgba(15,23,42,0.95)', border: '1px solid rgba(148,163,184,0.25)', borderRadius: 1, px: 1.5, py: 1 }}>
    <Typography variant="caption" sx={{ color: '#94a3b8', fontWeight: 700, display: 'block', mb: 0.5 }}>
      {title}
    </Typography>
    {children}
  </Box>
);

const TooltipRow: React.FC<{ label: string; value: string; color?: string }> = ({ label, value, color }) => (
  <Stack direction="row" justifyContent="space-between" spacing={2}>
    <Typography variant="caption" sx={{ color: '#cbd5e1' }}>{label}</Typography>
    <Typography variant="caption" sx={{ color: color ?? '#f8fafc', fontWeight: 700, fontFamily: 'monospace' }}>{value}</Typography>
  </Stack>
);

const PnlTooltip: React.FC<any> = ({ active, payload }) => {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload as { ts: number; invested: number; portfolio: number; pnl: number; pnlPct: number };
  return (
    <TooltipCard title={new Date(p.ts).toLocaleDateString()}>
      <TooltipRow label="Portfolio" value={fmtGbp(p.portfolio)} color="#22c55e" />
      <TooltipRow label="Invested" value={fmtGbp(p.invested)} color="#60a5fa" />
      <TooltipRow label="P&L" value={`${fmtGbp(p.pnl)} (${p.pnlPct >= 0 ? '+' : ''}${p.pnlPct.toFixed(2)}%)`} color={p.pnl >= 0 ? '#22c55e' : '#ef4444'} />
    </TooltipCard>
  );
};

const DrawdownTooltip: React.FC<any> = ({ active, payload }) => {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload as { ts: number; drawdownPct: number };
  return (
    <TooltipCard title={new Date(p.ts).toLocaleDateString()}>
      <TooltipRow label="Drawdown" value={`${p.drawdownPct.toFixed(2)}%`} color="#ef4444" />
    </TooltipCard>
  );
};

const RoiTooltip: React.FC<any> = ({ active, payload }) => {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload as { ts: number; pnlPct: number; pnl: number };
  return (
    <TooltipCard title={new Date(p.ts).toLocaleDateString()}>
      <TooltipRow
        label="ROI"
        value={`${p.pnlPct >= 0 ? '+' : ''}${p.pnlPct.toFixed(2)}%`}
        color={p.pnlPct >= 0 ? '#22c55e' : '#ef4444'}
      />
      <TooltipRow label="P&L" value={fmtGbp(p.pnl)} color={p.pnl >= 0 ? '#22c55e' : '#ef4444'} />
    </TooltipCard>
  );
};

const KV: React.FC<{ label: string; value: string; sub?: string; mono?: boolean }> = ({
  label,
  value,
  sub,
  mono,
}) => (
  <Box>
    <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600 }}>
      {label}
    </Typography>
    <Typography
      variant="body1"
      sx={{ fontWeight: 700, fontFamily: mono ? 'monospace' : undefined }}
    >
      {value}
    </Typography>
    {sub && (
      <Typography variant="caption" color="text.secondary">
        {sub}
      </Typography>
    )}
  </Box>
);

const StatTile: React.FC<{ label: string; value: string; color: string; sub?: string }> = ({ label, value, color, sub }) => (
  <Paper variant="outlined" sx={{ px: 2, py: 1.25, minWidth: 170, flex: '1 1 170px' }}>
    <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600, display: 'block' }}>
      {label}
    </Typography>
    <Typography variant="h6" sx={{ fontWeight: 900, color }}>
      {value}
    </Typography>
    {sub && (
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.25 }}>
        {sub}
      </Typography>
    )}
  </Paper>
);

export default CqmBotTab;
