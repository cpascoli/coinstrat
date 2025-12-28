import React, { useEffect, useState } from 'react';
import { Box } from '@mui/material';

type Score012 = 0 | 1 | 2;
type OutputMode = 'PAUSE' | 'ACCUMULATE' | 'TURBO';

type MockSignals = {
  VAL: Score012;
  LIQ: Score012;
  DXY: Score012;
  BIZ: Score012;
  MVRV: number;
  OUTPUT: OutputMode;
};

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randBetween(min: number, max: number) {
  return min + Math.random() * (max - min);
}

function nextMockSignals(): MockSignals {
  const VAL = pick<Score012>([0, 1, 2]);
  const LIQ = pick<Score012>([0, 1, 2]);
  const DXY = pick<Score012>([0, 1, 2]);
  const BIZ = pick<Score012>([0, 1, 2]);
  const MVRV = Number(randBetween(0.75, 2.25).toFixed(2));

  // Heuristic mock output (keeps it plausible): any strong headwind -> PAUSE, strong tailwinds -> TURBO else ACCUMULATE
  const OUTPUT: OutputMode =
    (DXY === 0 && VAL === 0) || (LIQ === 0 && BIZ === 0)
      ? 'PAUSE'
      : (VAL === 2 && (LIQ + BIZ) >= 3 && DXY >= 1)
        ? 'TURBO'
        : 'ACCUMULATE';

  return { VAL, LIQ, DXY, BIZ, MVRV, OUTPUT };
}

function scoreColor(v: Score012) {
  if (v === 2) return { fill: '#22c55e', text: '#bbf7d0' };
  if (v === 1) return { fill: '#94a3b8', text: '#e2e8f0' };
  return { fill: '#ef4444', text: '#fecaca' };
}

export const HeroIllustration: React.FC = () => {
  const cycleMs = 5000;
  const cycleDur = '5s';
  const [mock, setMock] = useState<MockSignals>(() => nextMockSignals());

  useEffect(() => {
    // New random inputs every 5s.
    const id = window.setInterval(() => setMock(nextMockSignals()), cycleMs);
    return () => window.clearInterval(id);
  }, [cycleMs]);

  return (
    <Box
      component="svg"
      viewBox="0 0 760 520"
      width="100%"
      height="auto"
      role="img"
      aria-label="Abstract illustration: a digital engine compressing chaos into order"
      sx={{ display: 'block' }}
    >
      <defs>
      {/* Background */}
      <linearGradient id="ae-bg" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stopColor="#070b14" />
        <stop offset="55%" stopColor="#0b1220" />
        <stop offset="100%" stopColor="#0b1326" />
      </linearGradient>

      {/* Energy palette */}
      <linearGradient id="ae-spectrum" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0%" stopColor="rgba(96,165,250,0.95)" />
        <stop offset="50%" stopColor="rgba(167,139,250,0.85)" />
        <stop offset="100%" stopColor="rgba(34,197,94,0.85)" />
      </linearGradient>
      <radialGradient id="ae-ink" cx="50%" cy="50%" r="60%">
        <stop offset="0%" stopColor="rgba(148,163,184,0.22)" />
        <stop offset="55%" stopColor="rgba(148,163,184,0.08)" />
        <stop offset="100%" stopColor="rgba(148,163,184,0)" />
      </radialGradient>
      <radialGradient id="ae-blue" cx="50%" cy="50%" r="60%">
        <stop offset="0%" stopColor="rgba(96,165,250,0.40)" />
        <stop offset="55%" stopColor="rgba(96,165,250,0.12)" />
        <stop offset="100%" stopColor="rgba(96,165,250,0)" />
      </radialGradient>
      <radialGradient id="ae-green" cx="50%" cy="50%" r="60%">
        <stop offset="0%" stopColor="rgba(34,197,94,0.32)" />
        <stop offset="55%" stopColor="rgba(34,197,94,0.10)" />
        <stop offset="100%" stopColor="rgba(34,197,94,0)" />
      </radialGradient>
      <radialGradient id="ae-purple" cx="50%" cy="50%" r="60%">
        <stop offset="0%" stopColor="rgba(167,139,250,0.30)" />
        <stop offset="55%" stopColor="rgba(167,139,250,0.10)" />
        <stop offset="100%" stopColor="rgba(167,139,250,0)" />
      </radialGradient>
      {/* Left-side chaos palette (warmer) */}
      <radialGradient id="ae-chaosRed" cx="50%" cy="50%" r="60%">
        <stop offset="0%" stopColor="rgba(239,68,68,0.07)" />
        <stop offset="55%" stopColor="rgba(239,68,68,0.05)" />
        <stop offset="100%" stopColor="rgba(239,68,68,0)" />
      </radialGradient>
      <radialGradient id="ae-chaosMagenta" cx="50%" cy="50%" r="60%">
        <stop offset="0%" stopColor="rgba(236,72,153,0.26)" />
        <stop offset="55%" stopColor="rgba(236,72,153,0.10)" />
        <stop offset="100%" stopColor="rgba(236,72,153,0)" />
      </radialGradient>

      {/* Soft glow */}
      <filter id="ae-glow" x="-40%" y="-40%" width="180%" height="180%">
        <feGaussianBlur stdDeviation="12" result="b" />
        <feColorMatrix
          in="b"
          type="matrix"
          values="
            1 0 0 0 0
            0 1 0 0 0
            0 0 1 0 0
            0 0 0 .40 0"
          result="g"
        />
        <feMerge>
          <feMergeNode in="g" />
          <feMergeNode in="SourceGraphic" />
        </feMerge>
      </filter>

      {/* Left chaos field */}
      <filter id="ae-chaos" x="-30%" y="-30%" width="160%" height="160%">
        <feTurbulence type="fractalNoise" baseFrequency="0.012 0.05" numOctaves="2" seed="13" result="t">
          <animate attributeName="baseFrequency" values="0.010 0.04; 0.016 0.065; 0.010 0.04" dur="10s" repeatCount="indefinite" />
          <animate attributeName="seed" values="13;15;13" dur="10s" repeatCount="indefinite" />
        </feTurbulence>
        <feDisplacementMap in="SourceGraphic" in2="t" scale="18" xChannelSelector="R" yChannelSelector="G" />
      </filter>

      {/* “Digital engine” core turbulence */}
      <filter id="ae-core" x="-30%" y="-30%" width="160%" height="160%">
        <feTurbulence type="turbulence" baseFrequency="0.01 0.02" numOctaves="1" seed="6" result="n">
          <animate attributeName="baseFrequency" values="0.010 0.020; 0.013 0.026; 0.010 0.020" dur="9s" repeatCount="indefinite" />
        </feTurbulence>
        <feColorMatrix
          in="n"
          type="matrix"
          values="
            0 0 0 0 0.20
            0 0 0 0 0.40
            0 0 0 0 0.55
            0 0 0 .28 0"
          result="cn"
        />
        <feGaussianBlur in="cn" stdDeviation="1.0" result="cnBlur" />
        {/* Clip the turbulence to the source shape to avoid any square filter box */}
        <feComposite in="cnBlur" in2="SourceGraphic" operator="in" result="maskedNoise" />
        <feMerge>
          <feMergeNode in="SourceGraphic" />
          <feMergeNode in="maskedNoise" />
        </feMerge>
      </filter>

      {/* Mask: left half, fading to center */}
      <linearGradient id="ae-leftFade" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0%" stopColor="rgba(255,255,255,0.90)" />
        <stop offset="78%" stopColor="rgba(255,255,255,0.25)" />
        <stop offset="100%" stopColor="rgba(255,255,255,0)" />
      </linearGradient>
      <mask id="ae-leftMask">
        <rect x="24" y="24" width="420" height="472" rx="22" fill="url(#ae-leftFade)" />
      </mask>

      {/* Mask: right half, fading from center to the right */}
      <linearGradient id="ae-rightFade" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0%" stopColor="rgba(255,255,255,0)" />
        <stop offset="28%" stopColor="rgba(255,255,255,0.28)" />
        <stop offset="100%" stopColor="rgba(255,255,255,0.85)" />
      </linearGradient>
      <mask id="ae-rightMask">
        <rect x="316" y="24" width="420" height="472" rx="22" fill="url(#ae-rightFade)" />
      </mask>

      {/* Beam gradient that sweeps */}
      <linearGradient id="ae-beam" x1="-0.2" y1="0" x2="0.8" y2="0">
        <stop offset="0%" stopColor="rgba(96,165,250,0)" />
        <stop offset="40%" stopColor="rgba(96,165,250,0.24)" />
        <stop offset="60%" stopColor="rgba(34,197,94,0.26)" />
        <stop offset="100%" stopColor="rgba(34,197,94,0)" />
        <animate attributeName="x1" values="-0.25;0.15;-0.25" dur={cycleDur} repeatCount="indefinite" />
        <animate attributeName="x2" values="0.75;1.15;0.75" dur={cycleDur} repeatCount="indefinite" />
      </linearGradient>
    </defs>

    {/* Base canvas */}
    <rect x="16" y="16" width="728" height="488" rx="26" fill="url(#ae-bg)" />

    {/* INPUTS (mock signal chips) */}
    {/* Vertically centered block: canvas center ~260px; this block height ~160px => y≈180–200 */}
    <g transform="translate(42 192)" opacity="0.0">
      {/* Quick fade in/out, visible for most of the cycle */}
      <animate attributeName="opacity" values="0;0.92;0.92;0" keyTimes="0;0.2;0.80;1" dur={cycleDur} repeatCount="indefinite" />
      <text x="0" y="0" fill="#94a3b8" fontFamily="ui-sans-serif, system-ui" fontSize="13" fontWeight="900">
        INPUTS
      </text>

      {(
        [
          { k: 'VAL', v: mock.VAL },
          { k: 'LIQ', v: mock.LIQ },
          { k: 'DXY', v: mock.DXY },
          { k: 'BIZ', v: mock.BIZ },
        ] as const
      ).map((row, i) => {
        const c = scoreColor(row.v);
        const y = 22 + i * 30;
        return (
          <g key={row.k} transform={`translate(0 ${y})`}>
            <rect x="0" y="-17" width="70" height="24" rx="12" fill="rgba(2,6,23,0.90)" stroke="rgba(148,163,184,0.22)" />
            <text x="13" y="0" fill="#cbd5e1" fontFamily="ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, Liberation Mono, Courier New, monospace" fontSize="13.5" fontWeight="900">
              {row.k}
            </text>
            <rect x="78" y="-17" width="46" height="24" rx="12" fill={`${c.fill}22`} stroke={`${c.fill}90`} />
            <text x="94" y="0" fill={c.text} fontFamily="ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, Liberation Mono, Courier New, monospace" fontSize="13.5" fontWeight="1000">
              {row.v}
            </text>
          </g>
        );
      })}

      {/* MVRV (mock value) */}
      <g transform="translate(0 152)">
        <rect x="0" y="-17" width="70" height="24" rx="12" fill="rgba(2,6,23,0.60)" stroke="rgba(148,163,184,0.22)" />
        <text x="13" y="0" fill="#cbd5e1" fontFamily="ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, Liberation Mono, Courier New, monospace" fontSize="13.5" fontWeight="900">
          MVRV
        </text>
        <rect x="78" y="-17" width="72" height="24" rx="12" fill="rgba(251,191,36,0.12)" stroke="rgba(251,191,36,0.60)" />
        <text x="90" y="0" fill="#fde68a" fontFamily="ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, Liberation Mono, Courier New, monospace" fontSize="13.5" fontWeight="1000">
          {mock.MVRV.toFixed(2)}
        </text>
      </g>
    </g>

    {/* Left: chaos (gradient ink + noise + drifting “threads”) */}
    <g mask="url(#ae-leftMask)" opacity="1">
      {/* drifting ink */}
      <g filter="url(#ae-glow)" opacity="0.95">
        <g>
          <animateTransform attributeName="transform" type="translate" values="0 0; 10 -6; 0 0" dur="10s" repeatCount="indefinite" />
          <circle cx="120" cy="170" r="150" fill="url(#ae-chaosRed)" />
          <circle cx="220" cy="260" r="170" fill="url(#ae-purple)" />
          <circle cx="170" cy="210" r="140" fill="url(#ae-chaosMagenta)" opacity="0.85" />
        </g>
        <g>
          <animateTransform attributeName="transform" type="translate" values="0 0; -12 10; 0 0" dur="11s" repeatCount="indefinite" />
          <circle cx="160" cy="340" r="190" fill="url(#ae-chaosRed)" opacity="0.9" />
          <circle cx="90" cy="290" r="120" fill="url(#ae-ink)" opacity="0.8" />
        </g>
      </g>

      {/* noisy surface */}
      <rect x="24" y="24" width="420" height="472" rx="22" fill="rgba(148,163,184,0.06)" filter="url(#ae-chaos)" opacity="0.55" />

      {/* thin “threads” that drift */}
      <g opacity="0.55" filter="url(#ae-glow)">
        <g>
          <animateTransform attributeName="transform" type="translate" values="0 0; 8 -4; 0 0" dur="9s" repeatCount="indefinite" />
          <path d="M44 140 C 98 88, 146 194, 208 144 C 268 96, 308 196, 372 136" fill="none" stroke="rgba(148,163,184,0.22)" strokeWidth="1.2" />
          <path d="M52 214 C 126 168, 160 260, 238 214 C 312 170, 330 270, 398 220" fill="none" stroke="rgba(236,72,153,0.20)" strokeWidth="1.1" />
          <path d="M48 296 C 124 264, 160 332, 238 306 C 314 280, 332 356, 406 330" fill="none" stroke="rgba(239,68,68,0.20)" strokeWidth="1.0" />
        </g>
        <g>
          <animateTransform attributeName="transform" type="translate" values="0 0; -7 6; 0 0" dur="10.5s" repeatCount="indefinite" />
          <path d="M58 360 C 132 336, 170 398, 252 378 C 332 360, 356 424, 418 410" fill="none" stroke="rgba(167,139,250,0.20)" strokeWidth="1.0" />
        </g>
      </g>
    </g>

    {/* Center: engine core (the “processor”) */}
    <g transform="translate(338 260)">
      {/* Pulse in/out while rotating (subtle breathing) */}
      <g>
        <animateTransform
          attributeName="transform"
          type="scale"
          values="1;1.085;0.94;1.065;1"
          dur={cycleDur}
          repeatCount="indefinite"
        />

        <circle cx="0" cy="0" r="92" fill="rgba(2,6,23,0.55)" />
        <circle cx="0" cy="0" r="92" fill="url(#ae-ink)" opacity="0.75" filter="url(#ae-glow)" />
        <circle cx="0" cy="0" r="62" fill="rgba(2,6,23,0.35)" />
        <circle cx="0" cy="0" r="62" fill="rgba(96,165,250,0.10)" filter="url(#ae-core)" />

        {/* rotating ring */}
        <g opacity="0.85">
          <animateTransform attributeName="transform" type="rotate" from="0 0 0" to="360 0 0" dur="18s" repeatCount="indefinite" />
          <circle cx="0" cy="0" r="78" fill="none" stroke="url(#ae-spectrum)" strokeWidth="2" strokeDasharray="10 14" opacity="0.55" />
          <circle cx="0" cy="0" r="78" fill="none" stroke="rgba(148,163,184,0.16)" strokeWidth="1" strokeDasharray="2 10" />
        </g>
      </g>
    </g>

    {/* Compression beam (subtle) */}
    <g opacity="0.95" filter="url(#ae-glow)">
      <path
        d="M70 276 C 190 250, 268 256, 322 262 C 396 270, 460 274, 706 290"
        fill="none"
        stroke="url(#ae-beam)"
        strokeWidth="14"
        opacity="0.72"
      />
      <path
        d="M70 276 C 190 250, 268 256, 322 262 C 396 270, 460 274, 706 290"
        fill="none"
        stroke="rgba(226,232,240,0.06)"
        strokeWidth="1.2"
      />
    </g>

    {/* Right: order field (calmer, structured glow) */}
    <g mask="url(#ae-rightMask)" opacity="1">
      {/* stable gradient atmosphere */}
      <g opacity="0.85" filter="url(#ae-glow)">
        <circle cx="610" cy="190" r="160" fill="url(#ae-green)" opacity="0.65" />
        <circle cx="680" cy="300" r="190" fill="url(#ae-blue)" opacity="0.55" />
      </g>

      {/* ordered “rails” */}
      <g opacity="0.55">
        {Array.from({ length: 10 }).map((_, i) => (
          <rect
            key={`rail-${i}`}
            x={468 + (i % 2) * 10}
            y={130 + i * 28}
            width={260 - (i % 3) * 30}
            height="2"
            rx="1"
            fill="rgba(148,163,184,0.16)"
          />
        ))}
      </g>
    </g>

    {/* One clean “decision” pulse on the right (slow glow) */}
    <g opacity="0.0" filter="url(#ae-glow)">
      {/* Quick fade in/out, visible for most of the cycle */}
      <animate attributeName="opacity" values="0;0.8;0.8;0" keyTimes="0;0.07;0.93;1" dur={cycleDur} repeatCount="indefinite" />
      <rect x="508" y="220" width="196" height="86" rx="18" fill="rgba(2,6,23,0.62)" />
      <rect x="508" y="220" width="196" height="86" rx="18" fill="url(#ae-spectrum)" opacity="0.10" />
      <text x="532" y="258" fill="#e5e7eb" fontFamily="ui-sans-serif, system-ui" fontSize="13.5" fontWeight="900" opacity="0.95">
        OUTPUT SIGNAL
      </text>
      <text x="532" y="292" fill="#bbf7d0" fontFamily="ui-sans-serif, system-ui" fontSize="20" fontWeight="950">
        {mock.OUTPUT}
      </text>
    </g>
    </Box>
  );
};


