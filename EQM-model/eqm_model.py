#!/usr/bin/env python3
"""
Reverse-engineered Bitcoin Empirical Quantile Model (EQM) prototype.

This is a falsifiable replica of the visible BTCAnalytica EQM mechanics, not an
official implementation. It uses only daily BTC price, a nonlinear time trend,
and empirical quantiles of the price residual around that trend.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
import io
import json
import math
from typing import Iterable

import numpy as np
import pandas as pd
import requests
import statsmodels.api as sm  # type: ignore[import-untyped]


DEFAULT_LOCAL_JSON = Path(__file__).resolve().parents[1] / "web" / "public" / "data" / "btc_daily.json"


@dataclass(frozen=True)
class EQMFit:
    intercept: float
    slope: float
    time_power: float
    residual_low: float
    residual_high: float
    residual_median: float
    residuals: pd.Series
    scores: pd.Series
    start_date: pd.Timestamp
    low_quantile: float
    high_quantile: float
    score_lower_quantile: float = 0.06
    score_upper_quantile: float = 0.995
    score_power: float = 1.0
    risk_gamma_start: float = 1.30
    risk_gamma_2018: float = 1.10
    risk_gamma_2022: float = 0.90
    risk_gamma_current: float = 0.75
    risk_high_quantile_start: float = 0.999
    risk_high_quantile_2018: float = 0.990
    risk_high_quantile_2022: float = 0.950
    end_date: pd.Timestamp | None = None


@dataclass(frozen=True)
class QuantileRegressionFit:
    start_date: pd.Timestamp
    time_power: float
    params_by_quantile: dict[float, tuple[float, float]]


@dataclass(frozen=True)
class BacktestSummary:
    start: pd.Timestamp
    end: pd.Timestamp
    base_amount: float
    final_btc: float
    final_cash: float
    final_price: float
    final_equity: float
    avg_buy_price: float | None
    avg_sell_price: float | None
    spread: float | None
    max_drawdown: float
    peak_capital: float
    mean_capital: float
    cagr_peak_capital: float | None
    cagr_mean_capital: float | None


def load_local_json(path: Path = DEFAULT_LOCAL_JSON) -> pd.Series:
    """Load the repo's bundled BTC daily JSON file."""
    with path.open("r", encoding="utf-8") as f:
        rows = json.load(f)

    df = pd.DataFrame(rows)
    if "date" not in df.columns and "d" in df.columns:
        df["date"] = df["d"]
    if "close" not in df.columns and "v" in df.columns:
        df["close"] = df["v"]
    if "date" not in df.columns or "close" not in df.columns:
        raise ValueError("BTC JSON must contain date/close or d/v fields.")

    df["date"] = pd.to_datetime(df["date"])
    df["close"] = pd.to_numeric(df["close"], errors="coerce")
    series = df.dropna(subset=["date", "close"]).set_index("date")["close"].sort_index()
    series.name = "BTCUSD"
    return series


def load_csv(path: Path, date_col: str = "date", price_col: str = "close") -> pd.Series:
    """Load daily BTC prices from a CSV file."""
    df = pd.read_csv(path)
    df[date_col] = pd.to_datetime(df[date_col])
    df[price_col] = pd.to_numeric(df[price_col], errors="coerce")
    series = df.dropna(subset=[price_col]).set_index(date_col)[price_col].sort_index()
    series.name = "BTCUSD"
    return series


def fetch_stooq_btc() -> pd.Series:
    """Fetch free BTC/USD daily closes from Stooq."""
    url = "https://stooq.com/q/d/l/?s=btcusd&i=d"
    response = requests.get(url, timeout=30)
    response.raise_for_status()

    df = pd.read_csv(io.StringIO(response.text))
    df["Date"] = pd.to_datetime(df["Date"])
    df["Close"] = pd.to_numeric(df["Close"], errors="coerce")
    series = df.dropna(subset=["Close"]).set_index("Date")["Close"].sort_index()
    series.name = "BTCUSD"
    return series


def fetch_binance_btc(start_ms: int | None = None, symbol: str = "BTCUSDT") -> pd.Series:
    """Fetch daily BTC closes from Binance klines (mirrors web/src/services/crypto.ts).

    Returns a daily close series indexed by date. `start_ms` optionally limits
    the fetch to candles on/after that epoch-millisecond timestamp; otherwise
    Binance returns its most recent window.
    """
    url = "https://api.binance.com/api/v3/klines"
    end_ms = int(pd.Timestamp.utcnow().timestamp() * 1000)
    if start_ms is None:
        start_ms = int(pd.Timestamp("2017-08-01").timestamp() * 1000)

    rows: list[tuple[pd.Timestamp, float]] = []
    cursor = int(start_ms)
    while cursor < end_ms:
        params = {
            "symbol": symbol,
            "interval": "1d",
            "limit": 1000,
            "startTime": cursor,
            "endTime": end_ms,
        }
        response = requests.get(url, params=params, timeout=30)
        response.raise_for_status()
        candles = response.json()
        if not isinstance(candles, list) or not candles:
            break
        for candle in candles:
            open_time = pd.Timestamp(int(candle[0]), unit="ms")
            rows.append((open_time.normalize(), float(candle[4])))
        last_open = int(candles[-1][0])
        if last_open + 1 <= cursor:
            break
        cursor = last_open + 1
        if len(candles) < 1000:
            break

    if not rows:
        raise RuntimeError("Binance returned no klines.")
    series = pd.Series({date: price for date, price in rows}, name="BTCUSD").sort_index()
    series.index = pd.DatetimeIndex(series.index)
    return series


def load_local_plus_binance_tail(path: Path = DEFAULT_LOCAL_JSON) -> pd.Series:
    """Load the bundled history and extend it with the live Binance daily tail.

    This is the Python equivalent of the app's hybrid `fetchBTCPrice`: local
    JSON for deep history, Binance klines for everything after the last local
    date. Binance values take precedence on any overlapping dates.
    """
    local = load_local_json(path)
    last_local = pd.Timestamp(local.index.max())
    start_ms = int((last_local + pd.Timedelta(days=1)).timestamp() * 1000)
    try:
        tail = fetch_binance_btc(start_ms=start_ms)
    except Exception as error:  # noqa: BLE001 - network is best-effort
        print(f"[warn] Binance tail fetch failed ({error}); using local history only.")
        return local
    merged = local.copy()
    for date, price in tail.items():
        merged.loc[date] = price
    merged = merged.sort_index()
    merged.name = "BTCUSD"
    return merged


def clean_price_series(series: pd.Series, start: str | None = "2011-01-01") -> pd.Series:
    """Normalize index, remove bad rows, and optionally truncate early history."""
    out = series.copy()
    out.index = pd.to_datetime(out.index).normalize()
    out = out.groupby(out.index).last().sort_index()
    out = pd.to_numeric(out, errors="coerce").dropna()
    out = out[out > 0]
    if start:
        out = out.loc[pd.Timestamp(start) :]
    out.name = "BTCUSD"
    return out


def _time_index(index: pd.DatetimeIndex, start_date: pd.Timestamp, time_power: float) -> np.ndarray:
    days = (index.normalize() - start_date.normalize()).days.astype(float) + 1.0
    days = np.maximum(days, 1.0)
    return np.power(days, time_power)


def fit_eqm(
    prices: pd.Series,
    low_quantile: float = 0.06,
    high_quantile: float = 0.68,
    time_power: float = 0.60,
    score_lower_quantile: float = 0.06,
    score_upper_quantile: float = 0.995,
    score_power: float = 1.0,
    risk_gamma_start: float = 1.35,
    risk_gamma_2018: float = 1.20,
    risk_gamma_2022: float = 1.08,
    risk_high_quantile_start: float = 0.999,
    risk_high_quantile_2018: float = 0.990,
    risk_high_quantile_2022: float = 0.950,
) -> EQMFit:
    """
    Fit the EQM proxy.

    Model:
      log(price) = intercept + slope * days_since_start**time_power + residual

    The risk is the empirical percentile of the residual mapped to [0, 1] via
    the low/high quantile anchors. The score uses a separate lower-to-upper-tail
    residual range so that it behaves like a pointier valuation oscillator
    instead of saturating through most of a bull market.

    Defaults are calibrated against the May 22, 2026 reference snapshot.
    """
    prices = clean_price_series(prices, start=None)
    if len(prices) < 100:
        raise ValueError("Need at least 100 daily prices to fit EQM.")
    if not 0 <= score_lower_quantile < score_upper_quantile <= 1:
        raise ValueError("score_lower_quantile must be lower than score_upper_quantile within [0, 1]")
    if score_power <= 0:
        raise ValueError("score_power must be positive")

    start_date = prices.index.min()
    x = _time_index(prices.index, start_date, time_power)
    y = np.log(prices.to_numpy(dtype=float))

    slope, intercept = np.polyfit(x, y, 1)
    trend = intercept + slope * x
    residuals = pd.Series(y - trend, index=prices.index, name="residual")

    residual_low = float(residuals.quantile(low_quantile))
    residual_high = float(residuals.quantile(high_quantile))
    residual_median = float(residuals.quantile(0.50))

    if math.isclose(residual_low, residual_high):
        raise ValueError("Residual quantile span is zero; cannot score EQM.")

    score_low = float(residuals.quantile(score_lower_quantile))
    score_high = float(residuals.quantile(score_upper_quantile))
    if math.isclose(score_low, score_high):
        raise ValueError("Score residual quantile span is zero; cannot score EQM.")

    score_raw = ((residuals - score_low) / (score_high - score_low)).clip(0.0, 1.0)
    scores = pd.Series(np.power(score_raw, score_power), index=residuals.index, name="eqm_score")
    end_date = pd.Timestamp(prices.index.max())

    latest_residual_percentile = empirical_percentile(residuals, float(residuals.iloc[-1]))
    latest_linear_risk = (latest_residual_percentile - low_quantile) / (high_quantile - low_quantile)
    latest_linear_risk = float(np.clip(latest_linear_risk, 0.0, 1.0))
    latest_soft_z = (latest_residual_percentile - low_quantile) / (high_quantile - low_quantile)
    latest_soft_z = float(np.clip(latest_soft_z, 0.0, 1.0))
    if 0.0 < latest_linear_risk < 1.0 and 0.0 < latest_soft_z < 1.0:
        risk_gamma_current = math.log(latest_linear_risk) / math.log(latest_soft_z)
    else:
        # Degenerate endpoints cannot solve a unique exponent; keep continuity.
        risk_gamma_current = 1.0

    return EQMFit(
        intercept=float(intercept),
        slope=float(slope),
        time_power=float(time_power),
        residual_low=residual_low,
        residual_high=residual_high,
        residual_median=residual_median,
        residuals=residuals,
        scores=scores,
        start_date=start_date,
        low_quantile=low_quantile,
        high_quantile=high_quantile,
        score_lower_quantile=float(score_lower_quantile),
        score_upper_quantile=float(score_upper_quantile),
        score_power=float(score_power),
        risk_gamma_start=float(risk_gamma_start),
        risk_gamma_2018=float(risk_gamma_2018),
        risk_gamma_2022=float(risk_gamma_2022),
        risk_gamma_current=float(risk_gamma_current),
        risk_high_quantile_start=float(risk_high_quantile_start),
        risk_high_quantile_2018=float(risk_high_quantile_2018),
        risk_high_quantile_2022=float(risk_high_quantile_2022),
        end_date=end_date,
    )


def fit_quantile_regression(
    prices: pd.Series,
    quantiles: Iterable[float] = (0.001, 0.50, 0.999),
    time_power: float = 0.50,
    max_iter: int = 10_000,
) -> QuantileRegressionFit:
    """
    Fit true quantile regression bands for log(price).

    These are the best candidate for the screenshot's dashed "QR" bands:
      QuantReg(log(price) ~ days_since_start**time_power)
    """
    prices = clean_price_series(prices, start=None)
    if len(prices) < 100:
        raise ValueError("Need at least 100 daily prices to fit quantile regression.")

    start_date = prices.index.min()
    x = _time_index(prices.index, start_date, time_power)
    design = sm.add_constant(x)
    y = np.log(prices.to_numpy(dtype=float))
    model = sm.QuantReg(y, design)

    params_by_quantile: dict[float, tuple[float, float]] = {}
    for quantile in quantiles:
        q = float(quantile)
        if not 0 < q < 1:
            raise ValueError(f"Quantile must be between 0 and 1: {q}")
        result = model.fit(q=q, max_iter=max_iter)
        intercept, slope = result.params
        params_by_quantile[q] = (float(intercept), float(slope))

    return QuantileRegressionFit(
        start_date=start_date,
        time_power=float(time_power),
        params_by_quantile=params_by_quantile,
    )


def trend_log(fit: EQMFit, dates: Iterable[pd.Timestamp]) -> np.ndarray:
    index = pd.DatetimeIndex(dates)
    x = _time_index(index, fit.start_date, fit.time_power)
    return fit.intercept + fit.slope * x


@dataclass(frozen=True)
class EQMSolidBandsFit:
    """
    Solid EQM band model (mirrors the TypeScript port in `web/src/utils/cqm.ts`).

    For each historical date `t`:

      r(s)             = price(s) / rolling_ATH(s)               for s ≤ t

      gold_raw(t)      = ATH(t) * Q_0.5( r over last `gold_window` days )
      gold_shelved(t)  = running_max( gold_raw[0..t] )
      gold_ceiling(t)  = rolling_min(price, gold_floor_window) × gold_floor_buffer
      gold(t)          = min( gold_shelved(t), gold_ceiling(t) )

      green_raw(t)     = ATH(t) * weighted_Q_0.05( r,
                              weights = exp(-λ_green × age_in_years) )
      green_shelved(t) = running_max( green_raw[0..t] )
      green_floor(t)   = rolling_min(price, green_floor_window) × green_floor_buffer
      green(t)         = min( green_shelved(t), green_floor(t) )

      upper(t)         = max( ATH(t) * upper_ath_factor, gold(t) )

    Both the gold and green bands are shelved (running-max) and then clipped
    by a price-relative ceiling so they sit between BTC and the rolling-min
    price during bear markets. The ceiling buffer is large for gold (~2.0×
    rolling-min, so gold stays between red and green) and small for green
    (~0.95× rolling-min, so green is a deep-value floor BELOW price).

    The green band is shelved with an additional price-floor constraint
    that forces it below the recent rolling-minimum price (× a small safety
    buffer). This makes green a true "deep value floor" that sits below
    BTC during the bottoming phases of every cycle (2015, 2018, 2020 covid,
    2022). At higher prices the constraint doesn't bind and the band
    behaves identically to the shelved-only version — preserving the
    snapshot match.

    The gold band uses the same constraint with a larger buffer (~2.0×
    rolling-min), which doesn't bind during bull markets / corrections from
    peak (preserving the snapshot match), but pulls gold DOWN during deep
    bear bottoms where the previous-cycle's shelved level would otherwise
    sit far above the realistic fair-value range.

    The green band's time-decay weighting (default half-life = 1 year)
    biases the low quantile toward recent observations so that as BTC has
    matured, the implied green/ATH multiplier drifts upward over time
    (≈ 0.27 in 2018, ≈ 0.37 in 2026).

    Verified against the BTCAnalytica May 22, 2026 snapshot:
      EQM 0.1%   $45.4K  → predicted $47.8K  (+5.2%)   [floor-clipped green]
      EQM 50%    $108.4K → predicted $111.9K (+3.2%)   [shelved gold]
      EQM 99.9%  $159.4K → predicted $159.6K (+0.1%)   [ATH × 1.28]
    """
    qr_median: "QuantileRegressionFit"
    residuals: pd.Series
    low_tau: float
    upper_ath_factor: float
    gold_window: int
    gold_floor_window: int
    gold_floor_buffer: float
    green_half_life_years: float
    green_quantile: float
    green_floor_window: int
    green_floor_buffer: float
    rolling_ath: pd.Series
    log_offset_low: float
    gold_band: pd.Series
    green_band: pd.Series


def _shelved_ath_relative_band(
    prices: pd.Series,
    rolling_ath: pd.Series,
    window: int,
    quantile: float,
    min_periods: int | None = None,
) -> pd.Series:
    """
    Compute `running_max( ATH(t) * Q_q( price/ATH over last `window` days ) )`.

    Returns a series aligned with `prices`. Values before `min_periods`
    samples have accumulated are NaN.
    """
    if min_periods is None:
        min_periods = max(window // 4, 30)
    ratios = prices.to_numpy(dtype=float) / rolling_ath.to_numpy(dtype=float)
    ratio_series = pd.Series(ratios, index=prices.index)
    rolling_q = ratio_series.rolling(window=window, min_periods=min_periods).quantile(quantile)
    raw = rolling_q.to_numpy(dtype=float) * rolling_ath.to_numpy(dtype=float)
    raw_series = pd.Series(raw, index=prices.index)
    shelved = raw_series.cummax()
    shelved.name = f"shelved_ath_q{quantile:g}_w{window}"
    return shelved


def _time_decayed_quantile_band(
    prices: pd.Series,
    rolling_ath: pd.Series,
    half_life_years: float,
    quantile: float,
    min_history_days: int = 365,
    max_lookback_days: int = 1825,
) -> pd.Series:
    """
    For each t, return `ATH(t) × weighted_Q_q( price/ATH ratios over last
    max_lookback_days, weights = exp(-λ × age_in_years) )`, where
    λ = ln(2) / half_life_years.

    `max_lookback_days` truncates the lookback (default 5 years) for speed;
    with a 1-year half-life, weights beyond 5 years are <3% and the
    truncation error is negligible.

    The result is NOT running-max here; the caller can apply `cummax()` if
    a shelved curve is desired.
    """
    p = prices.to_numpy(dtype=float)
    a = rolling_ath.to_numpy(dtype=float)
    ratios = p / a
    n = len(p)
    lam = math.log(2.0) / float(half_life_years)
    out = np.full(n, np.nan)

    for t in range(n):
        if t < min_history_days:
            continue
        start = max(0, t - max_lookback_days + 1)
        sub = ratios[start : t + 1]
        ages_years = np.arange(t - start, -1, -1, dtype=float) / 365.25
        weights = np.exp(-lam * ages_years)
        order = np.argsort(sub)
        sorted_ratios = sub[order]
        sorted_weights = weights[order]
        cum_w = np.cumsum(sorted_weights)
        total = cum_w[-1]
        if total <= 0:
            continue
        target = quantile * total
        idx = int(np.searchsorted(cum_w, target))
        idx = min(idx, len(sorted_ratios) - 1)
        out[t] = a[t] * sorted_ratios[idx]

    return pd.Series(
        out,
        index=prices.index,
        name=f"time_decayed_q{quantile:g}_hl{half_life_years:g}y",
    )


def fit_eqm_solid_bands(
    prices: pd.Series,
    low_tau: float = 0.001,
    upper_ath_factor: float = 1.28,
    time_power: float = 0.60,
    gold_window: int = 730,
    gold_floor_window: int = 30,
    gold_floor_buffer: float = 2.0,
    green_half_life_years: float = 1.0,
    green_quantile: float = 0.05,
    green_floor_window: int = 30,
    green_floor_buffer: float = 0.95,
) -> "EQMSolidBandsFit":
    """Fit the solid EQM band model used in BTCAnalytica's chart legend."""
    cleaned = clean_price_series(prices, start=None)
    qr_median = fit_quantile_regression(cleaned, quantiles=[0.5], time_power=time_power)
    median_band = quantile_regression_series(qr_median, cleaned.index, 0.5)
    residuals = pd.Series(
        np.log(cleaned.to_numpy(dtype=float)) - np.log(median_band.to_numpy(dtype=float)),
        index=cleaned.index,
        name="residual_about_qr_median",
    )
    rolling_ath = cleaned.expanding(min_periods=1).max()
    log_offset_low = float(residuals.quantile(low_tau))

    gold_shelved = _shelved_ath_relative_band(
        cleaned,
        rolling_ath,
        window=int(gold_window),
        quantile=0.5,
    )

    green_raw = _time_decayed_quantile_band(
        cleaned,
        rolling_ath,
        half_life_years=float(green_half_life_years),
        quantile=float(green_quantile),
    )
    green_shelved = green_raw.cummax()

    # Price-relative ceiling for both gold and green:
    #   - Green is clipped at `green_floor_buffer × rolling_min(price)` (with
    #     buffer ≈ 0.95) so it sits BELOW BTC at every cycle bottom and
    #     visually acts as a deep-value floor.
    #   - Gold is clipped at `gold_floor_buffer × rolling_min(price)` (with
    #     buffer ≈ 2.0) so during deep bear bottoms it gets pulled down from
    #     the previous-cycle shelved level toward the realistic fair-value
    #     range — staying "approximately between red and green" on the chart.
    # In both cases the constraint doesn't bind during bull markets /
    # corrections from peak, so the BTCAnalytica snapshot match is preserved.
    gold_rolling_min = cleaned.rolling(
        window=int(gold_floor_window), min_periods=1
    ).min()
    gold_ceiling = gold_rolling_min * float(gold_floor_buffer)
    gold_band = pd.concat([gold_shelved, gold_ceiling], axis=1).min(axis=1)
    gold_band.name = "shelved_floored_gold"

    green_rolling_min = cleaned.rolling(
        window=int(green_floor_window), min_periods=1
    ).min()
    green_ceiling = green_rolling_min * float(green_floor_buffer)
    green_band = pd.concat([green_shelved, green_ceiling], axis=1).min(axis=1)
    green_band.name = "shelved_floored_time_decayed_green"

    return EQMSolidBandsFit(
        qr_median=qr_median,
        residuals=residuals,
        low_tau=float(low_tau),
        upper_ath_factor=float(upper_ath_factor),
        gold_window=int(gold_window),
        gold_floor_window=int(gold_floor_window),
        gold_floor_buffer=float(gold_floor_buffer),
        green_half_life_years=float(green_half_life_years),
        green_quantile=float(green_quantile),
        green_floor_window=int(green_floor_window),
        green_floor_buffer=float(green_floor_buffer),
        rolling_ath=rolling_ath,
        log_offset_low=log_offset_low,
        gold_band=gold_band,
        green_band=green_band,
    )


def solid_band_series(
    fit: "EQMSolidBandsFit",
    dates: Iterable[pd.Timestamp],
    band: str,
) -> pd.Series:
    """Return a solid EQM band series for one of: 'lower', 'median', 'upper'."""
    index = pd.DatetimeIndex(dates)
    median_qr = quantile_regression_series(fit.qr_median, index, 0.5)
    # Fallback for the warm-up window where the rolling/decayed quantile is
    # NaN: use the parabolic QR-median × log-offset model so the line is
    # plotted continuously from the start of the chart.
    parabolic_lower = median_qr.to_numpy(dtype=float) * math.exp(fit.log_offset_low)

    if band == "median":
        gold = fit.gold_band.reindex(index)
        gold = gold.where(gold.notna(), median_qr)
        return gold.rename("solid_median")
    if band == "lower":
        green = fit.green_band.reindex(index)
        values = np.where(
            green.notna().to_numpy(),
            green.to_numpy(dtype=float),
            parabolic_lower,
        )
        return pd.Series(values, index=index, name="solid_lower")
    if band == "upper":
        gold = fit.gold_band.reindex(index)
        gold = gold.where(gold.notna(), median_qr)
        ath = fit.rolling_ath.reindex(index, method="ffill")
        capped_ath = ath.bfill().fillna(median_qr)
        upper_values = np.maximum(
            capped_ath.to_numpy(dtype=float) * fit.upper_ath_factor,
            gold.to_numpy(dtype=float),
        )
        return pd.Series(upper_values, index=index, name="solid_upper")
    raise ValueError(f"Unknown band: {band!r}. Expected 'lower', 'median', or 'upper'.")


def quantile_regression_series(
    fit: QuantileRegressionFit,
    dates: Iterable[pd.Timestamp],
    quantile: float,
) -> pd.Series:
    """Return a fitted QR price band for the requested quantile."""
    q = float(quantile)
    if q not in fit.params_by_quantile:
        available = ", ".join(f"{value:g}" for value in sorted(fit.params_by_quantile))
        raise ValueError(f"QR quantile {q:g} was not fit. Available: {available}")

    index = pd.DatetimeIndex(dates)
    x = _time_index(index, fit.start_date, fit.time_power)
    intercept, slope = fit.params_by_quantile[q]
    values = np.exp(intercept + slope * x)
    return pd.Series(values, index=index, name=f"qr_{q:g}")


def band_series(fit: EQMFit, dates: Iterable[pd.Timestamp], residual_quantile: float) -> pd.Series:
    """Return price band for a residual quantile."""
    index = pd.DatetimeIndex(dates)
    residual = float(fit.residuals.quantile(residual_quantile))
    values = np.exp(trend_log(fit, index) + residual)
    return pd.Series(values, index=index, name=f"band_{residual_quantile:g}")


def score_for_price(fit: EQMFit, date: pd.Timestamp, price: float) -> float:
    """Map price to a pointier EQM score using separate tail anchors."""
    log_trend = float(trend_log(fit, [pd.Timestamp(date)])[0])
    residual = math.log(price) - log_trend
    score_low = float(fit.residuals.quantile(fit.score_lower_quantile))
    score_high = float(fit.residuals.quantile(fit.score_upper_quantile))
    score_raw = (residual - score_low) / (score_high - score_low)
    return float(np.clip(score_raw, 0.0, 1.0) ** fit.score_power)


def empirical_percentile(history: pd.Series, value: float) -> float:
    """Percentile rank in [0, 1] using empirical CDF."""
    hist = history.dropna().to_numpy(dtype=float)
    if len(hist) == 0:
        return float("nan")
    return float(np.searchsorted(np.sort(hist), value, side="right") / len(hist))


def risk_for_score(fit: EQMFit, score: float) -> float:
    """Map EQM score to risk using the empirical score distribution."""
    return empirical_percentile(fit.scores, score)


def risk_gamma_for_date(fit: EQMFit, date: pd.Timestamp) -> float:
    """Cycle-aware soft-risk exponent, linearly interpolated across BTC cycles."""
    end_date = pd.Timestamp(fit.end_date or fit.residuals.index.max())
    knots = [
        (pd.Timestamp("2014-01-01"), fit.risk_gamma_start),
        (pd.Timestamp("2018-01-01"), fit.risk_gamma_2018),
        (pd.Timestamp("2022-01-01"), fit.risk_gamma_2022),
        (end_date, fit.risk_gamma_current),
    ]
    target = pd.Timestamp(date)
    if target <= knots[0][0]:
        return float(knots[0][1])

    previous_date, previous_gamma = knots[0]
    for next_date, next_gamma in knots[1:]:
        if target <= next_date:
            span_days = max((next_date - previous_date).days, 1)
            progress = (target - previous_date).days / span_days
            return float(previous_gamma + progress * (next_gamma - previous_gamma))
        previous_date, previous_gamma = next_date, next_gamma

    return float(knots[-1][1])


def risk_high_quantile_for_date(fit: EQMFit, date: pd.Timestamp) -> float:
    """Cycle-aware upper risk anchor that decays toward today's calibration."""
    end_date = pd.Timestamp(fit.end_date or fit.residuals.index.max())
    knots = [
        (pd.Timestamp("2014-01-01"), fit.risk_high_quantile_start),
        (pd.Timestamp("2018-01-01"), fit.risk_high_quantile_2018),
        (pd.Timestamp("2022-01-01"), fit.risk_high_quantile_2022),
        (end_date, fit.high_quantile),
    ]
    target = pd.Timestamp(date)
    if target <= knots[0][0]:
        return float(knots[0][1])

    previous_date, previous_quantile = knots[0]
    for next_date, next_quantile in knots[1:]:
        if target <= next_date:
            span_days = max((next_date - previous_date).days, 1)
            progress = (target - previous_date).days / span_days
            return float(previous_quantile + progress * (next_quantile - previous_quantile))
        previous_date, previous_quantile = next_date, next_quantile

    return float(knots[-1][1])


def risk_for_price(fit: EQMFit, date: pd.Timestamp, price: float) -> float:
    """Map price to cycle-aware soft risk at a date."""
    log_trend = float(trend_log(fit, [pd.Timestamp(date)])[0])
    residual = math.log(price) - log_trend
    residual_percentile = empirical_percentile(fit.residuals, residual)
    high_quantile = risk_high_quantile_for_date(fit, pd.Timestamp(date))
    soft_z = (residual_percentile - fit.low_quantile) / (high_quantile - fit.low_quantile)
    soft_z = float(np.clip(soft_z, 0.0, 1.0))
    return float(soft_z ** risk_gamma_for_date(fit, pd.Timestamp(date)))


def price_for_risk(fit: EQMFit, date: pd.Timestamp, risk: float) -> float:
    """Invert the current date's price-risk curve."""
    risk = float(np.clip(risk, 0.0, 1.0))
    gamma = risk_gamma_for_date(fit, pd.Timestamp(date))
    if gamma <= 0:
        raise ValueError("Risk gamma must be positive")
    high_quantile = risk_high_quantile_for_date(fit, pd.Timestamp(date))
    residual_quantile = fit.low_quantile + (risk ** (1.0 / gamma)) * (high_quantile - fit.low_quantile)
    residual = float(fit.residuals.quantile(residual_quantile))
    log_price = float(trend_log(fit, [pd.Timestamp(date)])[0]) + residual
    return float(math.exp(log_price))


def current_snapshot(fit: EQMFit, prices: pd.Series, date: pd.Timestamp | None = None) -> dict[str, float]:
    """Return the latest visible EQM values for diagnostics."""
    prices = clean_price_series(prices, start=None)
    if date is None:
        date = prices.index.max()
    date = pd.Timestamp(date)
    price = float(prices.loc[:date].iloc[-1])
    score = score_for_price(fit, date, price)
    risk = risk_for_price(fit, date, price)

    return {
        "price": price,
        "score": score,
        "risk": risk,
        "eqm_0_1_pct": price_for_risk(fit, date, 0.0),
        "eqm_10_pct": price_for_risk(fit, date, 0.10),
        "eqm_25_pct": price_for_risk(fit, date, 0.25),
        "eqm_50_pct": price_for_risk(fit, date, 0.50),
        "eqm_75_pct": price_for_risk(fit, date, 0.75),
        "eqm_90_pct": price_for_risk(fit, date, 0.90),
        "eqm_99_9_pct": price_for_risk(fit, date, 1.0),
    }


def expanding_eqm_signals(
    prices: pd.Series,
    min_history_days: int = 1095,
    low_quantile: float = 0.06,
    high_quantile: float = 0.68,
    time_power: float = 0.60,
    score_lower_quantile: float = 0.06,
    score_upper_quantile: float = 0.995,
    score_power: float = 1.0,
) -> pd.DataFrame:
    """
    Compute no-lookahead daily EQM score/risk using only history available that day.

    This is slower than full-sample scoring but is the right default for backtests.
    """
    prices = clean_price_series(prices, start=None)
    rows: list[dict[str, float | pd.Timestamp]] = []

    for i in range(min_history_days, len(prices)):
        history = prices.iloc[: i + 1]
        fit = fit_eqm(
            history,
            low_quantile=low_quantile,
            high_quantile=high_quantile,
            time_power=time_power,
            score_lower_quantile=score_lower_quantile,
            score_upper_quantile=score_upper_quantile,
            score_power=score_power,
        )
        date = history.index[-1]
        price = float(history.iloc[-1])
        score = score_for_price(fit, date, price)
        risk = risk_for_price(fit, date, price)
        rows.append({"date": date, "price": price, "score": score, "risk": risk})

    return pd.DataFrame(rows).set_index("date")


def full_sample_eqm_signals(fit: EQMFit, prices: pd.Series) -> pd.DataFrame:
    """Compute full-sample EQM score/risk for chart replication."""
    prices = clean_price_series(prices, start=None)
    scores = pd.Series(
        [score_for_price(fit, date, float(price)) for date, price in prices.items()],
        index=prices.index,
        name="score",
    )
    risks = pd.Series(
        [risk_for_price(fit, date, float(price)) for date, price in prices.items()],
        index=prices.index,
        name="risk",
    )
    return pd.DataFrame({"price": prices, "score": scores, "risk": risks})


def run_risk_weighted_dca(
    signals: pd.DataFrame,
    start: str,
    end: str | None = None,
    base_amount: float = 500.0,
) -> tuple[pd.DataFrame, BacktestSummary]:
    """
    Run BTCAnalytica's published rule:

      daily_dollars = base_amount * (1 - 2 * risk)

    Positive dollars buy BTC. Negative dollars sell/short BTC.
    """
    df = signals.loc[pd.Timestamp(start) : pd.Timestamp(end) if end else None].copy()
    if df.empty:
        raise ValueError("No signal rows in requested backtest window.")

    df["daily_usd"] = base_amount * (1.0 - 2.0 * df["risk"])
    df["btc_delta"] = df["daily_usd"] / df["price"]
    df["btc_position"] = df["btc_delta"].cumsum()
    df["cash"] = -df["daily_usd"].cumsum()
    df["equity"] = df["cash"] + df["btc_position"] * df["price"]

    buy_mask = df["daily_usd"] > 0
    sell_mask = df["daily_usd"] < 0
    bought_btc = float(df.loc[buy_mask, "btc_delta"].sum())
    sold_btc = float(-df.loc[sell_mask, "btc_delta"].sum())
    buy_usd = float(df.loc[buy_mask, "daily_usd"].sum())
    sell_usd = float(-df.loc[sell_mask, "daily_usd"].sum())

    avg_buy = buy_usd / bought_btc if bought_btc > 0 else None
    avg_sell = sell_usd / sold_btc if sold_btc > 0 else None
    spread = avg_sell - avg_buy if avg_buy is not None and avg_sell is not None else None

    capital = df["daily_usd"].clip(lower=0).cumsum()
    peak_capital = float(capital.max())
    mean_capital = float(capital.mean())
    running_equity_high = df["equity"].cummax()
    if peak_capital > 0:
        drawdown = (df["equity"] - running_equity_high) / peak_capital
        max_drawdown = float(drawdown.min(skipna=True)) if not drawdown.dropna().empty else 0.0
    else:
        max_drawdown = 0.0

    years = max((df.index[-1] - df.index[0]).days / 365.25, 1 / 365.25)
    final_equity = float(df["equity"].iloc[-1])

    def cagr(denominator: float) -> float | None:
        if denominator <= 0 or final_equity <= -denominator:
            return None
        return float((1.0 + final_equity / denominator) ** (1.0 / years) - 1.0)

    summary = BacktestSummary(
        start=df.index[0],
        end=df.index[-1],
        base_amount=base_amount,
        final_btc=float(df["btc_position"].iloc[-1]),
        final_cash=float(df["cash"].iloc[-1]),
        final_price=float(df["price"].iloc[-1]),
        final_equity=final_equity,
        avg_buy_price=avg_buy,
        avg_sell_price=avg_sell,
        spread=spread,
        max_drawdown=max_drawdown,
        peak_capital=peak_capital,
        mean_capital=mean_capital,
        cagr_peak_capital=cagr(peak_capital),
        cagr_mean_capital=cagr(mean_capital),
    )
    return df, summary
