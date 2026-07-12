# CQM Model & Bot Review — 2026-07-11

Findings from a full review of the CQM model, the DCA bot, and the docs
(`CQM.md`). Reviewed files:

- `EQM-model/eqm_model.py` (Python reference model)
- `web/src/utils/cqm.ts` (production TS model)
- `web/src/utils/cqmSizing.ts` (shared dynamic sizing)
- `web/netlify/functions/lib/cqmBot.ts`, `cqmLedger.ts`, `scheduled-cqm-bot.ts` (bot)
- `CQM.md` (docs)

Test status at review time: `cqm.test.ts`, `cqm-sizing.test.ts`,
`cqmBot.test.ts`, `cqm-autocal.test.ts` — 27 passed, 1 skipped.

---

## 1. Documentation vs implementation

### CQM.md ↔ `web/src/utils/cqm.ts` — IN SYNC ✓

Verified: static linear risk map (`pBuy=0.06`, `pSell=0.72`), causal
auto-calibration (trailing 3y median residual, 4y ramp) as production default,
`riskMode='global'`, risk fair value = tail-scaled QR 50% (not gold SMA),
sizing defaults (6% cash taper, 0.50–0.75 dead zone, 1% BTC sell fraction),
bot uses the same fit + dynamic sizing on a virtual ledger.

**One doc error:** the DCA table in CQM.md says at Risk 0% "Buy ≥ $100
(2× base…)". With base $100, `base × (1 − 2·0)` = $100 = **1× base**. The
"2×" is a leftover from an older rule.

### CQM.md ↔ `EQM-model/eqm_model.py` — OUT OF SYNC ✗

The "keep in sync" claims (CQM.md line ~8 and `eqm_model.py:33`) are stale:

1. **No auto-calibration in Python.** Only the legacy manual anchor is
   implemented (`qr_calibration_date: 2026-05-28`, `$100,800`, ramp from
   2022-01-01). Production TS uses causal auto-cal. Python reference charts
   drift further from the app every day (fair was already $110.3K auto vs
   $100.8K manual at Example A in CQM.md).
2. **Python still uses the removed cycle-aware risk mapping.**
   `risk_from_residual_percentile` applies date-interpolated γ knots
   (1.35/1.20/1.08) and high-quantile knots (0.999/0.990/0.950 →
   `high_quantile`), with endpoint `high_quantile = 0.68` — not the tuned
   `pSell = 0.72` static map that TS uses.
3. **Dead code in `fit_eqm`:** `risk_gamma_current =
   log(latest_linear_risk)/log(latest_soft_z)` where both operands are
   computed by the *identical* formula → always exactly 1.0. The documented
   walk-forward finding ("γ resolved to 1.0 at the endpoint") is guaranteed
   by construction, not discovered. Deletable.
4. **`run_risk_weighted_dca` uses the legacy linear rule**
   `base × (1 − 2·risk)` with unconstrained negatives (can short BTC it
   doesn't hold, unbounded cash). It does NOT match the bot's dynamic sizing.
   Python backtest conclusions don't describe live bot behavior.

**Action:** either port auto-cal + static pBuy/pSell map +
`computeCqmDynamicTrade` to Python, or demote it in CQM.md to "historical
replica, not in sync since ~June 2026".

---

## 2. What works well

- Core idea is clean: risk = percentile rank of `ln(price/fair)` vs full
  residual history through a linear map. Few knobs; docs are honest that the
  calibration objective is ill-conditioned and `pSell` is a policy dial.
- **Causal auto-calibration is the best design decision** — self-corrects if
  BTC's power-law trajectory shifts, without look-ahead.
- Dynamic sizing (`6% × taper × cash`) fixes cash drag during deep-value
  windows; dead zone 0.50–0.75 avoids churn at fair value.
- Bot plumbing is solid: execution lease (unique constraint + stale cleanup),
  frequency hard-guard ignoring failed orders, kill switch, virtual ledger
  isolated from other exchange assets, server-side risk from the same signal
  cache as charts, full decision persistence in `cqm_bot_orders`.
- Real test coverage (sizing, ledger, frequency guard, autocal, walk-forward
  anchors).

## 3. What to improve

### Model / methodology

1. **`fit.signals` historical risk is in-sample** (fan + residual CDF fit on
   full sample). Live decision (last point) is causal, but backtests consuming
   `fit.signals` directly overstate performance. Deserves a loud flag.
2. **IRLS quantile regression at τ = 0.001/0.999 is fragile** (crude check-loss
   approximation, ~6 observations beyond the 0.1% band). Treat the 0.1%/99.9%
   bands as decorative; risk only depends on the well-behaved 50% line.
3. **Full-sample residual CDF never forgets** 2014–2017 mania residuals. With
   diminishing volatility, realized risk may cap out below 1.0 next bull →
   sell scale engages less than 2017/2021 backtests suggest. Sanity check:
   what percentile did the 2021 top reach under today's fit?
4. **Single-asset, single-model concentration** — one fitted parabola on ~2.5
   cycles of one asset. Auto-cal handles slow drift, not a regime break.
   No stop-loss exists anywhere in the system (by design; hold consciously).

### Bot / execution

5. **Virtual ledger funding.** Two sub-issues, both now fixed:
   - ~~Deposits were retroactively recomputed at the *current* base — raising
     base £100→£900 multiplied the historical deposit line 9×, inflating
     virtual cash → 6%-of-cash term fires a huge buy next slot.~~
     **FIXED 2026-07-11:** added `cqm_bot_settings_history` (migration 015);
     `saveSettings` appends a row whenever base/frequency changes, and
     `computeVirtualBalances` replays the deposit schedule slot by slot using
     the settings in force at each slot's start. Verified in prod: seed row
     matches first order (2026-05-25, £500 daily).
   - ~~No way to represent lump-sum capital; cash only entered via the drip.~~
     **FIXED 2026-07-11:** added `cqm_bot_deposits` (migration 016) — explicit
     capital injections joining the funding line from `deposited_at` onward
     (negative = mandate withdrawal; ledger cash floored at 0). Admin endpoint
     `/api/admin/cqm-bot/deposits` (GET/POST/DELETE) + "Fund" dialog in the
     bot admin panel. Intended use: stage tranches in at judged cycle bottom /
     early bull; the 6%-of-cash taper then deploys ≈ half the pile in ~11
     trading days at sustained low risk. Deposits are *virtual mandate
     funding* — the GBP must actually exist on Coinbase or sized buys fail.
6. **Risk on BTC-USD, execution on BTC-GBP.** Scale-free risk mostly
   neutralizes it, but P&L carries GBP/USD noise; decide the accounting
   currency deliberately.
7. **Sell side is not an income mechanism.** Sells need risk > 0.75
   (≈ 56th residual percentile), scale to `max(base, 1% BTC value)` per
   period. At daily cadence in a sustained top this liquidates ~0.5%/day at
   risk 0.9, but a cycle topping "early" in risk terms could pass with almost
   nothing realized. Fine for accumulation, not a withdrawal policy.

---

## 4. $100K/year on $500K — realism assessment

Goal: deploy ~$500K over 1–2 years, then realize ≥ $100K/year (20%/yr) over
subsequent cycles, purely via the CQM bot.

**Verdict: plausible as a full-cycle *average* under base-case assumptions;
NOT realistic as a guaranteed every-year figure.**

Favorable arithmetic:
- ~$500K at avg entry $65–85K ≈ 6–7.5 BTC. Repo's own forward sim
  (`cqmForwardSim.ts`) pins the 2029 visible peak at $200K–450K with
  ~40–50% retrace into 2030. Even at the low end: 6.5 BTC ≈ $1.3M →
  ~$200K/yr averaged over 4y.
- Repo's worst-scenario withdrawal sim ($500/day 18mo, then $10K/mo from
  2028): mean final ~$276K after withdrawing $420K vs $273K deposited →
  ≈ $84K/yr net even in the pessimistic family. But `minFinal` = $83K —
  bad seeds nearly exhaust the position.

Why "every year" fails:
- Bear years (2030-style) are negative on paper; annual income requires a
  harvested cash buffer of 1–2 years of income.
- `pSell = 0.72` was tuned for a *compressed / diminishing-returns* prior —
  can't simultaneously trust that conservative calibration and assume
  bullish-case income.
- Forward stress: ~30% max drawdown even with the model (vs ~48% passive).
  30% of $1M = three years of the income target, on paper.
- Regime-break risk: if the power law dies, risk reads "cheap" all the way
  down and the bot keeps buying. No stop-loss.
- Unmodeled frictions: taxes on realized sells, Coinbase fees/spread, GBP/USD.

Recommended changes to serve the goal:
1. Fix the ledger lump-sum gap (item 5) before scaling capital.
2. Add an explicit profit-taking/withdrawal layer on top of the risk-scaled
   sell — e.g. harvest a fixed dollar amount per month when risk > ~0.6 and
   gains exceed a threshold, banking 1–2 years of income before the cycle
   turns. Tune it with the existing withdrawal simulator.
3. Reframe the target as cycle-averaged: expect ~$0 realized in bear years
   and $200–400K realized across the 12–18 months around a top.
