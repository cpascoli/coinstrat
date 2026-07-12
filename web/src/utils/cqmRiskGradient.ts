/**
 * Shared CQM risk colour scale — a single continuous gradient that passes
 * through the four risk-zone colours (green → lime → amber → red), with the
 * transitions aligned to the 25 / 50 / 75% zone boundaries.
 *
 * Used by:
 *   - the Overview "Price map" scale bar (CSS gradient),
 *   - the "CQM Risk" time-series line in models/cqm/charts and the backtest Lab
 *     (SVG <linearGradient> applied as the line stroke).
 *
 * SVG gradients on a <path> map to the path's bounding box, not the chart's
 * 0–100 axis. To keep the colours tied to true risk values we build the SVG
 * stops from the series' actual min/max, interpolating the zone colours at the
 * clamped endpoints — see {@link buildRiskGradientStops}.
 */

export interface RiskColorStop {
  risk: number; // 0..100
  color: string; // hex
}

/** Anchor colours, one per zone boundary. Shared by every CQM risk surface. */
export const CQM_RISK_COLOR_STOPS: readonly RiskColorStop[] = [
  { risk: 0, color: '#22c55e' }, // deep value
  { risk: 25, color: '#84cc16' },
  { risk: 50, color: '#f59e0b' },
  { risk: 75, color: '#ef4444' },
  { risk: 100, color: '#dc2626' }, // peak euphoria
];

/** Horizontal CSS gradient (left = 0% risk, right = 100%). */
export const CQM_RISK_GRADIENT_CSS =
  'linear-gradient(90deg, #22c55e 0%, #84cc16 25%, #f59e0b 50%, #ef4444 75%, #dc2626 100%)';

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

function rgbToHex(rgb: [number, number, number]): string {
  return `#${rgb
    .map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0'))
    .join('')}`;
}

/** Linearly interpolate the zone colours at an arbitrary risk value (0..100). */
export function colorAtRisk(riskPct: number): string {
  const r = Math.max(0, Math.min(100, riskPct));
  const stops = CQM_RISK_COLOR_STOPS;
  for (let i = 0; i < stops.length - 1; i++) {
    const lo = stops[i];
    const hi = stops[i + 1];
    if (r >= lo.risk && r <= hi.risk) {
      const t = hi.risk === lo.risk ? 0 : (r - lo.risk) / (hi.risk - lo.risk);
      const a = hexToRgb(lo.color);
      const b = hexToRgb(hi.color);
      return rgbToHex([
        a[0] + (b[0] - a[0]) * t,
        a[1] + (b[1] - a[1]) * t,
        a[2] + (b[2] - a[2]) * t,
      ]);
    }
  }
  return stops[stops.length - 1].color;
}

export interface SvgGradientStop {
  offset: number; // 0..1, where 0 = top of the path (highest risk)
  color: string;
}

/**
 * Build vertical SVG gradient stops for a risk line whose values span
 * [minPct, maxPct]. Offset 0 is the top of the path (max risk), offset 1 the
 * bottom (min risk). Interior zone boundaries that fall inside the range get a
 * stop; the clamped endpoints are interpolated so colours always track the true
 * risk value regardless of how wide the series happens to be.
 */
export function buildRiskGradientStops(minPct: number, maxPct: number): SvgGradientStop[] {
  if (!Number.isFinite(minPct) || !Number.isFinite(maxPct)) {
    return [
      { offset: 0, color: colorAtRisk(100) },
      { offset: 1, color: colorAtRisk(0) },
    ];
  }
  if (maxPct - minPct < 1e-6) {
    const c = colorAtRisk(maxPct);
    return [
      { offset: 0, color: c },
      { offset: 1, color: c },
    ];
  }

  const span = maxPct - minPct;
  const stops: SvgGradientStop[] = [{ offset: 0, color: colorAtRisk(maxPct) }];
  for (const s of CQM_RISK_COLOR_STOPS) {
    if (s.risk > minPct && s.risk < maxPct) {
      stops.push({ offset: (maxPct - s.risk) / span, color: s.color });
    }
  }
  stops.push({ offset: 1, color: colorAtRisk(minPct) });
  return stops.sort((a, b) => a.offset - b.offset);
}
