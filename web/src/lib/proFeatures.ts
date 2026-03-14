export const PRO_ALERT_OPTIONS = [
  {
    key: 'CORE_ON',
    label: 'Core Accumulation',
    description: 'Email me when the core long-term accumulation engine switches on or off.',
  },
  {
    key: 'MACRO_ON',
    label: 'Macro Accelerator',
    description: 'Email me when the macro overlay turns on or off.',
  },
  {
    key: 'PRICE_REGIME_ON',
    label: 'Price Regime',
    description: 'Email me when BTC moves into or out of the supportive long-term trend regime.',
  },
  {
    key: 'VAL_SCORE',
    label: 'Valuation Score',
    description: 'Email me when valuation shifts between cheap, neutral, and expensive zones.',
  },
  {
    key: 'LIQ_SCORE',
    label: 'Liquidity Score',
    description: 'Email me when liquidity conditions improve or deteriorate.',
  },
  {
    key: 'CYCLE_SCORE',
    label: 'Business Cycle Score',
    description: 'Email me when cycle conditions move between supportive and risky states.',
  },
  {
    key: 'DXY_SCORE',
    label: 'Dollar Regime Score',
    description: 'Email me when dollar conditions become more supportive or hostile for BTC.',
  },
] as const;

export type ProAlertKey = typeof PRO_ALERT_OPTIONS[number]['key'];

export const OPENCLAW_SKILL_URL = '/openclaw/coinstrat-skill.md';

export function buildOpenClawInstallSnippet(apiKey: string): string {
  return [
    '# CoinStrat skill setup for OpenClaw',
    `export COINSTRAT_API_KEY="${apiKey}"`,
    `curl -fsSL https://coinstrat.xyz${OPENCLAW_SKILL_URL} -o ./coinstrat-skill.md`,
    '',
    '# Give your OpenClaw agent these instructions:',
    '# Use the CoinStrat API Skill in ./coinstrat-skill.md',
    '# Base URL: https://coinstrat.xyz',
    '# Include header: X-API-Key: $COINSTRAT_API_KEY',
  ].join('\n');
}
