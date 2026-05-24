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
    Solid EQM band model:

      lower_band(t) = QR_median(t) * exp(empirical_quantile(low_tau, residuals))
      upper_band(t) = QR_median(t) * upper_multiplier_at(t)

    where:
      - residuals[i] = log(price_i) - log(QR_median(date_i))
      - upper_multiplier_at(t) = max(rolling_ATH(t) * ath_factor, QR_median(t)) / QR_median(t)
        i.e. the upper band tracks recent all-time-high price * a fixed factor and
        floors it at the median when no new ATH has been printed yet.

    This empirically matches the BTCAnalytica reference for May 22, 2026 within
    a few percent. The lower-band hypothesis is well-supported (residual q=0.001
    about QR median); the upper-band hypothesis is heuristic and based on the
    visible ratio of the reference solid 99.9% band to recent ATH (~1.28x).
    """
    qr_median: "QuantileRegressionFit"
    residuals: pd.Series
    low_tau: float
    upper_ath_factor: float
    rolling_ath: pd.Series
    log_offset_low: float


def fit_eqm_solid_bands(
    prices: pd.Series,
    low_tau: float = 0.001,
    upper_ath_factor: float = 1.28,
    time_power: float = 0.60,
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

    return EQMSolidBandsFit(
        qr_median=qr_median,
        residuals=residuals,
        low_tau=float(low_tau),
        upper_ath_factor=float(upper_ath_factor),
        rolling_ath=rolling_ath,
        log_offset_low=log_offset_low,
    )


def solid_band_series(
    fit: "EQMSolidBandsFit",
    dates: Iterable[pd.Timestamp],
    band: str,
) -> pd.Series:
    """Return a solid EQM band series for one of: 'lower', 'median', 'upper'."""
    median = quantile_regression_series(fit.qr_median, dates, 0.5)
    if band == "median":
        return median.rename("solid_median")
    if band == "lower":
        values = median.to_numpy(dtype=float) * math.exp(fit.log_offset_low)
        return pd.Series(values, index=median.index, name="solid_lower")
    if band == "upper":
        ath = fit.rolling_ath.reindex(median.index, method="ffill")
        capped_ath = ath.bfill().fillna(median)
        upper_values = np.maximum(
            capped_ath.to_numpy(dtype=float) * fit.upper_ath_factor,
            median.to_numpy(dtype=float),
        )
        return pd.Series(upper_values, index=median.index, name="solid_upper")
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


def risk_for_price(fit: EQMFit, date: pd.Timestamp, price: float) -> float:
    """Map price to risk at a date."""
    log_trend = float(trend_log(fit, [pd.Timestamp(date)])[0])
    residual = math.log(price) - log_trend
    residual_percentile = empirical_percentile(fit.residuals, residual)
    risk = (residual_percentile - fit.low_quantile) / (fit.high_quantile - fit.low_quantile)
    return float(np.clip(risk, 0.0, 1.0))


def price_for_risk(fit: EQMFit, date: pd.Timestamp, risk: float) -> float:
    """Invert the current date's price-risk curve."""
    risk = float(np.clip(risk, 0.0, 1.0))
    residual_quantile = fit.low_quantile + risk * (fit.high_quantile - fit.low_quantile)
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
