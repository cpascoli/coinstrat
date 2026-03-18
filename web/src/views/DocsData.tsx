import React, { useMemo, useState } from 'react';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import { Box, Card, CardContent, CardHeader, Divider, IconButton, Stack, Tab, Tabs, Tooltip, Typography } from '@mui/material';
import DocsPageLayout from '../components/DocsPageLayout';
import DocsPager from '../components/DocsPager';

type DataFeedCategory = 'onchain' | 'liquidity' | 'currency' | 'business';

type DataFeed = {
  title: string;
  id: string;
  href: string;
  meaning: string;
  usage: string[];
  category: DataFeedCategory;
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
    category: 'liquidity',
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
    category: 'liquidity',
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
    category: 'liquidity',
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
    category: 'currency',
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
    category: 'business',
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
    category: 'business',
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
    category: 'business',
  },
  {
    title: 'Market Value to Realized Value',
    id: 'MVRV',
    href: 'https://www.blockchain.com/explorer/charts/mvrv',
    meaning: 'Bitcoin market-value to realized-value ratio, used as a valuation anchor.',
    usage: [
      'Core valuation input for accumulation signals.',
      'Low readings identify deeper-value zones; higher readings warn of stretched conditions.',
    ],
    category: 'onchain',
  },
  {
    title: 'Supply in Profit',
    id: 'SIP',
    href: 'https://charts.bgeometrics.com/supply_in_profit.html',
    meaning: 'Measures the amount of BTC that is currently in profit or loss based on the price at which each bitcoin last moved.',
    usage: [
      'Tracks euphoric conditions during late-cycle moves.',
      'Used with observation-window rules to detect exhaustion after overheated conditions.',
    ],
    category: 'onchain',
  },
  {
    title: 'LTH SOPR',
    id: 'LTH_SOPR',
    href: 'https://charts.bgeometrics.com/lth_sopr.html',
    meaning: 'The ratio of value realized vs cost basis for the outputs spent by long-term holders.',
    usage: [
      'Provides context on whether long-term holders are realizing profits or selling under stress.',
      'Included in the cached raw series and newsletter context for weekly interpretation.',
    ],
    category: 'onchain',
  },
  {
    title: 'STH Realized Price',
    id: 'STH_REALIZED_PRICE',
    href: 'https://charts.bgeometrics.com/sth_realized_price.html',
    meaning: 'Average on-chain cost basis of coins held by short-term holders, expressed in USD.',
    usage: [
      'Available as an on-chain valuation feed for charts and custom signal conditions.',
      'Useful for comparing spot price against the recent holder cost basis or tracking STH support/resistance zones.',
    ],
    category: 'onchain',
  },
  {
    title: 'LTH Realized Price',
    id: 'LTH_REALIZED_PRICE',
    href: 'https://charts.bgeometrics.com/lth_realized_price.html',
    meaning: 'Average on-chain cost basis of coins held by long-term holders, expressed in USD.',
    usage: [
      'Available as an on-chain valuation feed for charts and custom signal conditions.',
      'Useful for comparing spot price against long-term holder conviction and cycle-level cost-basis floors.',
    ],
    category: 'onchain',
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
    category: 'liquidity',
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
    category: 'liquidity',
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
    category: 'currency',
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
    category: 'currency',
  },
];

const DATA_FEED_TABS: Array<{
  label: string;
  category: DataFeedCategory;
  description: string;
}> = [
  {
    label: 'On-chain',
    category: 'onchain',
    description: 'Valuation and holder-behavior feeds sourced from on-chain data providers like BGeometrics and Blockchain.com.',
  },
  {
    label: 'Liquidity',
    category: 'liquidity',
    description: 'Central-bank balance sheets and reserve-drain inputs that shape the U.S. and global liquidity backdrop.',
  },
  {
    label: 'Currency',
    category: 'currency',
    description: 'Dollar and FX feeds used to classify currency headwinds and normalize cross-border liquidity series into USD terms.',
  },
  {
    label: 'Business Cycle',
    category: 'business',
    description: 'Macro growth and recession-risk indicators used to classify expansion, slowdown, and contraction conditions.',
  },
];

const DocsData: React.FC = () => {
  const [tabIdx, setTabIdx] = useState(0);
  const activeTab = DATA_FEED_TABS[tabIdx];
  const visibleFeeds = useMemo(
    () => DATA_FEEDS.filter((feed) => feed.category === activeTab.category),
    [activeTab.category],
  );

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

        <Tabs
          value={tabIdx}
          onChange={(_, next: number) => setTabIdx(next)}
          variant="scrollable"
          scrollButtons="auto"
          sx={{
            borderBottom: 1,
            borderColor: 'divider',
            '& .MuiTab-root': { fontWeight: 700, textTransform: 'none', minHeight: 42 },
          }}
        >
          {DATA_FEED_TABS.map((tab) => (
            <Tab key={tab.category} label={tab.label} />
          ))}
        </Tabs>

        <Box>
          <Typography variant="body2" color="text.secondary">
            {activeTab.description}
          </Typography>
        </Box>

        <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' } }}>
          {visibleFeeds.map((feed) => (
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
