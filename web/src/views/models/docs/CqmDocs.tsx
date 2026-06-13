import React from 'react';
import { Box, Divider, Paper, Typography } from '@mui/material';

const codeSx = {
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  fontSize: '0.85em',
  px: 0.6,
  py: 0.2,
  borderRadius: 1,
  bgcolor: 'rgba(148,163,184,0.16)',
  color: '#e2e8f0',
} as const;

const Formula: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <Box
    sx={{
      my: 1,
      px: 2,
      py: 1.25,
      borderRadius: 1.5,
      bgcolor: 'rgba(15,23,42,0.6)',
      border: '1px solid rgba(148,163,184,0.18)',
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
      fontSize: '0.85rem',
      color: '#e2e8f0',
      overflowX: 'auto',
      whiteSpace: 'pre',
    }}
  >
    {children}
  </Box>
);

const SectionTitle: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <Typography variant="subtitle1" sx={{ fontWeight: 800, mt: 3, mb: 1 }}>
    {children}
  </Typography>
);

const CqmDocs: React.FC = () => (
  <Paper sx={{ p: { xs: 2, sm: 3 } }}>
    <Typography variant="h6" sx={{ fontWeight: 800, mb: 1 }}>
      How the CoinStrat Quantile Model works
    </Typography>
    <Typography variant="body2" color="text.secondary" sx={{ mb: 1, lineHeight: 1.8 }}>
      CQM is a reverse-engineered approximation of BTCAnalytica&apos;s Empirical Quantile Model. It
      fits a quantile-regression price fan across BTC&apos;s full history, derives a fair value from
      it, and converts the latest price into a fair-value <strong>risk</strong> between 0% (deep
      value) and 100% (euphoric). Risk then drives the position-sizing rule the bot trades.
    </Typography>

    <Divider sx={{ my: 2, borderColor: 'rgba(148,163,184,0.18)' }} />

    {/* ---------------------------------------------------------------- */}
    <SectionTitle>1. Fair value — the quantile-regression fan</SectionTitle>
    <Typography variant="body2" color="text.secondary" sx={{ lineHeight: 1.8 }}>
      Bitcoin&apos;s log price grows roughly along a decelerating power-law in time. CQM fits a
      median (50th-percentile) regression of log price against a power of age, using only history
      from <Box component="code" sx={codeSx}>2014-01-01</Box> onward (the $0.30→$1,200 era of
      2011–13 distorts both the slope and the residual distribution):
    </Typography>
    <Formula>{`log(price) ≈ a + b · (days_since_2009) ^ 0.6`}</Formula>
    <Typography variant="body2" color="text.secondary" sx={{ lineHeight: 1.8 }}>
      The median line is fit by IRLS least-absolute-deviation (robust to blow-off tops and
      capitulations). An asymmetric fan of dotted quantiles is scaled around it; the dashed{' '}
      <Box component="code" sx={codeSx}>QR&nbsp;50%</Box> line is the <strong>fair value</strong>{' '}
      used by the risk model.
    </Typography>
    <Typography variant="body2" color="text.secondary" sx={{ mt: 1.5, lineHeight: 1.8 }}>
      <strong>Tail auto-calibration (causal).</strong> Rather than hand-anchoring the top of the
      fan, the QR&nbsp;50% endpoint is scaled so the median log-residual over the trailing{' '}
      <strong>3 years</strong> is zero, ramping in over the last <strong>4 years</strong>. It uses
      only data up to the evaluation date, so walk-forward (causal) fits never peek at the future.
    </Typography>

    {/* ---------------------------------------------------------------- */}
    <SectionTitle>2. Risk — mapping price to a 0–100% score</SectionTitle>
    <Typography variant="body2" color="text.secondary" sx={{ lineHeight: 1.8 }}>
      Risk is an <em>empirical percentile</em>, not a fixed distance from fair value. For each day
      we measure how far price sits above or below fair value in log space, then rank that residual
      against the full-sample distribution of all historical residuals:
    </Typography>
    <Formula>{`residual(t) = log(price) − log(QR_50%(t))
pct(t)      = empirical_percentile(residual(t), all residuals)   // 0..1
z(t)        = clamp( (pct − 0.06) / (highQ − 0.06), 0, 1 )
risk(t)     = z(t) ^ γ`}</Formula>
    <Typography variant="body2" color="text.secondary" sx={{ lineHeight: 1.8 }}>
      The lower knot <Box component="code" sx={codeSx}>0.06</Box> means the cheapest ~6% of history
      maps to 0% risk, and the upper knot <Box component="code" sx={codeSx}>highQ</Box> maps to 100%.
      Both <Box component="code" sx={codeSx}>highQ</Box> and the curvature exponent{' '}
      <Box component="code" sx={codeSx}>γ</Box> are <strong>cycle-aware</strong>: earlier cycles
      (2014/2018/2022) used a higher upper quantile and stronger γ so early blow-off moves don&apos;t
      all hard-clip at 100%, decaying toward today&apos;s calibration so the current snapshot stays
      faithful.
    </Typography>
    <Typography variant="body2" color="text.secondary" sx={{ mt: 1.5, lineHeight: 1.8 }}>
      The same mapping run in reverse (holding fair value fixed and sweeping price) produces the{' '}
      <em>Risk-as-a-function-of-price</em> curve on the charts page.
    </Typography>

    {/* ---------------------------------------------------------------- */}
    <SectionTitle>3. Risk zones</SectionTitle>
    <Box component="ul" sx={{ m: 0, pl: 3, display: 'flex', flexDirection: 'column', gap: 1 }}>
      <li><Typography variant="body2"><strong>0–25% — Buy zone:</strong> deep value, size up DCA.</Typography></li>
      <li><Typography variant="body2"><strong>25–50% — Accumulate:</strong> fair to cheap, keep buying (tapering).</Typography></li>
      <li><Typography variant="body2"><strong>50–75% — Hold:</strong> richening; no new buys, no sells (dead zone).</Typography></li>
      <li><Typography variant="body2"><strong>75–100% — Sell zone:</strong> euphoric, distribute.</Typography></li>
    </Box>

    {/* ---------------------------------------------------------------- */}
    <SectionTitle>4. Dynamic position sizing</SectionTitle>
    <Typography variant="body2" color="text.secondary" sx={{ lineHeight: 1.8 }}>
      The bot and the backtester share one sizing function. Given the period&apos;s base DCA amount,
      the current risk <Box component="code" sx={codeSx}>r</Box>, and the live cash / BTC balances,
      each period it computes a buy or a sell:
    </Typography>
    <Formula>{`# Buy zone  (r < 0.50)
taper    = (0.50 − r) / 0.50                  # 1 at r=0 → 0 at fair value
cashFrac = 0.06 × taper                       # up to 6% of idle cash at r=0
buy      = max( base × (1 − 2·r),  cashFrac × cash )
buy      = min( buy, cash )                   # never overspend

# Hold zone (0.50 ≤ r ≤ 0.75)
→ do nothing

# Sell zone (r > 0.75)
sellScale = (r − 0.75) / (1 − 0.75)           # 0 at 75% → 1 at 100%
size      = max( base, 0.01 × btc_value )
sell      = min( size × sellScale, btc_value )`}</Formula>
    <Typography variant="body2" color="text.secondary" sx={{ lineHeight: 1.8 }}>
      The key improvement over a plain linear rule is the{' '}
      <Box component="code" sx={codeSx}>cashFrac × cash</Box> term: when risk is low it deploys a
      fraction of the <em>accumulated idle cash</em>, not just a fixed multiple of the base amount.
      This solves the &ldquo;cash drag&rdquo; problem where a purely linear rule leaves large
      undeployed balances during deep-value windows. The linear{' '}
      <Box component="code" sx={codeSx}>base × (1 − 2·r)</Box> term remains as a floor.
    </Typography>
    <Typography variant="body2" color="text.secondary" sx={{ mt: 1.5, lineHeight: 1.8 }}>
      Defaults — <Box component="code" sx={codeSx}>maxCashFraction = 6%</Box>,{' '}
      <Box component="code" sx={codeSx}>sellThreshold = 75%</Box>,{' '}
      <Box component="code" sx={codeSx}>btcSellFraction = 1%</Box> — were tuned on a walk-forward
      grid across five historical windows (Jun 2026). Both knobs are adjustable in the Lab and in
      the bot&apos;s Strategy Settings.
    </Typography>

    {/* ---------------------------------------------------------------- */}
    <SectionTitle>5. Live signal vs. backtest (causality)</SectionTitle>
    <Typography variant="body2" color="text.secondary" sx={{ lineHeight: 1.8 }}>
      <strong>Live bot</strong> — each daily signal refresh refits the model on the{' '}
      <em>full price history up to today</em> and reads the latest risk. For today&apos;s value this
      is causal by construction (no future data exists yet).
    </Typography>
    <Typography variant="body2" color="text.secondary" sx={{ mt: 1, lineHeight: 1.8 }}>
      <strong>Backtest</strong> — the Lab uses a <em>walk-forward</em> risk series: the model is
      refit on an expanding window (every 90 days) so each historical day&apos;s risk only reflects
      what was knowable at the time. This avoids the look-ahead bias that would otherwise flatter
      backtested returns. The two series agree at the right edge but differ historically — exactly
      the intended trade-off: trade on the freshest full-sample fit, evaluate on the honest causal
      one.
    </Typography>
  </Paper>
);

export default CqmDocs;
