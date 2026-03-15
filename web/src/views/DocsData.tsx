import React from 'react';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import { Box, Card, CardContent, CardHeader, Divider, IconButton, Stack, Tooltip, Typography } from '@mui/material';
import DocsPageLayout from '../components/DocsPageLayout';
import DocsPager from '../components/DocsPager';

type DataFeed = {
  title: string;
  id: string;
  href: string;
  meaning: string;
  usage: string[];
};

const DATA_FEEDS: DataFeed[] = [
  {
    title: 'Fed Total Assets',
    id: 'WALCL',
    href: 'https://fred.stlouisfed.org/series/WALCL',
    meaning: 'The Federal Reserve’s total assets (balance sheet).',
    usage: [
      'Liquidity input used in the U.S. net-liquidity proxy.',
      'Contributes to US_LIQ = WALCL - WTREGEN - RRPONTSYD (with RRP normalized to matching units).',
    ],
  },
  {
    title: 'Treasury General Account',
    id: 'WTREGEN',
    href: 'https://fred.stlouisfed.org/series/WTREGEN',
    meaning: 'U.S. Treasury deposits held at the Fed.',
    usage: [
      'Liquidity input used in the U.S. net-liquidity proxy.',
      'Subtracted from WALCL when computing US_LIQ.',
    ],
  },
  {
    title: 'Overnight Reverse Repo',
    id: 'RRPONTSYD',
    href: 'https://fred.stlouisfed.org/series/RRPONTSYD',
    meaning: 'Daily ON RRP usage reported by the New York Fed.',
    usage: [
      'Liquidity input used in the U.S. net-liquidity proxy.',
      'Subtracted from WALCL when computing US_LIQ.',
      'Helps determine liquidity score changes through YoY and 13-week delta measures.',
    ],
  },
  {
    title: 'USD Index',
    id: 'DTWEXBGS',
    href: 'https://fred.stlouisfed.org/series/DTWEXBGS',
    meaning: 'Broad trade-weighted U.S. dollar index used as the dollar-strength proxy.',
    usage: [
      'Used to compute MA50, MA200, and ROC20 for the dollar regime.',
      'Feeds DXY_SCORE, which flags dollar headwinds or tailwinds for Bitcoin.',
    ],
  },
  {
    title: 'Sahm Rule',
    id: 'SAHMREALTIME',
    href: 'https://fred.stlouisfed.org/series/SAHMREALTIME',
    meaning: 'Monthly labor-market deterioration signal used as a recession-risk proxy.',
    usage: [
      'Feeds the business-cycle score.',
      'Elevated readings increase recession-risk and can block macro acceleration.',
    ],
  },
  {
    title: 'Yield Curve (10Y - 3M)',
    id: 'T10Y3M',
    href: 'https://fred.stlouisfed.org/series/T10Y3M',
    meaning: 'Daily 10-year minus 3-month Treasury spread.',
    usage: [
      'Feeds the business-cycle score.',
      'Inversion raises recession-risk; a healthier curve supports expansion conditions.',
    ],
  },
  {
    title: 'Manufacturers New Orders',
    id: 'AMTMNO',
    href: 'https://fred.stlouisfed.org/series/AMTMNO',
    meaning: 'Monthly manufacturing new-orders proxy for industrial demand.',
    usage: [
      'Used in the business-cycle score.',
      'Momentum in new orders helps confirm expansionary macro conditions.',
    ],
  },
  {
    title: 'MVRV Ratio',
    id: 'MVRV',
    href: 'https://charts.bitbo.io/mvrv-z-score/',
    meaning: 'Bitcoin market-value to realized-value ratio, used as a valuation anchor.',
    usage: [
      'Core valuation input for accumulation signals.',
      'Low readings identify deeper-value zones; higher readings warn of stretched conditions.',
    ],
  },
  {
    title: 'Supply in Profit',
    id: 'SIP',
    href: 'https://charts.bitbo.io/supply-in-profit/',
    meaning: 'Share of Bitcoin supply currently sitting in unrealized profit.',
    usage: [
      'Tracks euphoric conditions during late-cycle moves.',
      'Used with observation-window rules to detect exhaustion after overheated conditions.',
    ],
  },
  {
    title: 'LTH SOPR',
    id: 'LTH_SOPR',
    href: 'https://charts.bitbo.io/lth-sopr/',
    meaning: 'Spent Output Profit Ratio for long-term holders.',
    usage: [
      'Provides context on whether long-term holders are realizing profits or selling under stress.',
      'Included in the cached raw series and newsletter context for weekly interpretation.',
    ],
  },
  {
    title: 'ECB Total Assets',
    id: 'ECB_RAW',
    href: 'https://data.ecb.europa.eu/',
    meaning: 'European Central Bank balance-sheet series used in global liquidity context.',
    usage: [
      'Cached as a raw series for transparency and future model expansion.',
      'Helps track liquidity conditions outside the United States.',
    ],
  },
  {
    title: 'BoJ Total Assets',
    id: 'BOJ_RAW',
    href: 'https://www.boj.or.jp/en/statistics/boj/other/acmai/release/',
    meaning: 'Bank of Japan balance-sheet series used in global liquidity context.',
    usage: [
      'Cached as a raw series for transparency and future model expansion.',
      'Helps track liquidity conditions outside the United States.',
    ],
  },
  {
    title: 'EURUSD FX',
    id: 'EURUSD',
    href: 'https://fred.stlouisfed.org/',
    meaning: 'Euro to U.S. dollar exchange rate used in liquidity normalization.',
    usage: [
      'Used to convert ECB series into a common dollar-denominated frame.',
      'Supports consistent cross-region liquidity comparisons.',
    ],
  },
  {
    title: 'JPYUSD FX',
    id: 'JPYUSD',
    href: 'https://fred.stlouisfed.org/',
    meaning: 'Japanese yen to U.S. dollar exchange rate used in liquidity normalization.',
    usage: [
      'Used to convert BoJ series into a common dollar-denominated frame.',
      'Supports consistent cross-region liquidity comparisons.',
    ],
  },
];

const DocsData: React.FC = () => {
  return (
    <DocsPageLayout>
      <Stack spacing={3}>
        <Box>
          <Typography
            variant="h3"
            component="h1"
            sx={{ fontWeight: 900, fontSize: { xs: 30, sm: 38, md: 46 }, mb: 1 }}
          >
            Data Feeds
          </Typography>
          <Typography sx={{ color: 'text.secondary', maxWidth: 760 }}>
            CoinStrat derives its scores from external macro, valuation, and market data sources.
            These are the raw feeds that back the liquidity, cycle, valuation, and trend signals.
          </Typography>
        </Box>

        <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' } }}>
          {DATA_FEEDS.map((feed) => (
            <ReferenceCard key={feed.id} {...feed} />
          ))}
        </Box>

        <DocsPager />
      </Stack>
    </DocsPageLayout>
  );
};

const ReferenceCard: React.FC<DataFeed> = ({ title, id, href, meaning, usage }) => (
  <Card>
    <CardHeader
      title={
        <Box sx={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 1.5 }}>
          <Typography sx={{ fontWeight: 900, lineHeight: 1.15 }}>
            {title} -{' '}
            <Box
              component="span"
              sx={{
                fontFamily:
                  'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
                fontWeight: 800,
              }}
            >
              {id}
            </Box>
          </Typography>
          <Tooltip title="Open source">
            <IconButton
              component="a"
              href={href}
              target="_blank"
              rel="noreferrer"
              size="small"
              sx={{
                color: '#fff',
                border: '1px solid',
                borderColor: 'rgba(148,163,184,0.35)',
                bgcolor: 'rgba(2,6,23,0.18)',
                '&:hover': { borderColor: 'rgba(148,163,184,0.6)', bgcolor: 'rgba(2,6,23,0.28)' },
              }}
              aria-label={`Open ${id} source`}
            >
              <OpenInNewIcon sx={{ fontSize: 16, color: '#fff' }} />
            </IconButton>
          </Tooltip>
        </Box>
      }
      subheader={
        <Typography variant="body2" color="text.secondary">
          {meaning}
        </Typography>
      }
    />
    <Divider />
    <CardContent>
      <Box
        sx={{
          border: '1px solid',
          borderColor: 'divider',
          borderRadius: 2,
          px: 2,
          py: 1.25,
          bgcolor: 'rgba(2,6,23,0.10)',
        }}
      >
        <Typography variant="overline" color="text.secondary">
          How it is used
        </Typography>
        <Stack component="ul" spacing={0.75} sx={{ mt: 0.5, pl: 2 }}>
          {usage.map((item) => (
            <Typography component="li" variant="body2" key={item} sx={{ color: 'text.primary' }}>
              {item}
            </Typography>
          ))}
        </Stack>
      </Box>
    </CardContent>
  </Card>
);

export default DocsData;
