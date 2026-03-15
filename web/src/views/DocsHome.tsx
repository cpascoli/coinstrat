import React from 'react';
import { Box, Button, Card, CardContent, Stack, Typography } from '@mui/material';
import { useNavigate } from 'react-router-dom';
import { Activity, BarChart3, Binary, Database, Workflow } from 'lucide-react';
import DocsPageLayout from '../components/DocsPageLayout';
import DocsPager from '../components/DocsPager';

const DocsHome: React.FC = () => {
  const navigate = useNavigate();

  return (
    <DocsPageLayout>
      <Stack spacing={3}>
        <Box>
          <Typography
            variant="h3"
            component="h1"
            sx={{ fontWeight: 900, fontSize: { xs: 30, sm: 38, md: 46 }, mb: 1 }}
          >
            Docs
          </Typography>
          <Typography sx={{ color: 'text.secondary', maxWidth: 720 }}>
            Reference material for CoinStrat. Understand the external data
            feeds behind the model, and see how the signal engine is assembled.
          </Typography>
        </Box>

        <Box sx={{ display: 'grid', gap: 2.5, gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' } }}>
          <DocsCard
            icon={<Activity size={20} />}
            title="Architecture"
            text="The full CoinStrat pipeline from raw time series, to engineered metrics, to scores, to stateful signals and final portfolio permission."
            actionLabel="Open Architecture"
            onClick={() => navigate('/docs/architecture')}
          />
          <DocsCard
            icon={<Database size={20} />}
            title="Data Feeds"
            text="All third-party data series used to compute liquidity, valuation, trend, and business-cycle signals."
            actionLabel="View Data Feeds"
            onClick={() => navigate('/docs/data')}
          />
          <DocsCard
            icon={<BarChart3 size={20} />}
            title="Scores"
            text="Definitions, formulas, thresholds, and rationale for valuation, liquidity, cycle, and dollar-regime scoring."
            actionLabel="Open Scores Docs"
            onClick={() => navigate('/docs/scores')}
          />
          <DocsCard
            icon={<Binary size={20} />}
            title="Signals"
            text="How the Core Engine, Macro Accelerator, and final accumulation permission are synthesized from the factor scores."
            actionLabel="Open Signals Docs"
            onClick={() => navigate('/docs/signals')}
          />
          <DocsCard
            icon={<Workflow size={20} />}
            title="Signal Builder"
            text="Build custom strategies in plain English. Learn about the available series, metric operators, comparators, and see example prompts."
            actionLabel="Open Signal Builder Docs"
            onClick={() => navigate('/docs/signal-builder')}
          />
        </Box>

        <DocsPager />
      </Stack>
    </DocsPageLayout>
  );
};

const DocsCard: React.FC<{
  icon: React.ReactNode;
  title: string;
  text: string;
  actionLabel: string;
  onClick: () => void;
}> = ({ icon, title, text, actionLabel, onClick }) => (
  <Card
    sx={{
      borderColor: 'rgba(148,163,184,0.35)',
      background: 'linear-gradient(180deg, rgba(2,6,23,0.35) 0%, rgba(15,23,42,0.65) 100%)',
      boxShadow: 'none',
      height: '100%',
    }}
  >
    <CardContent sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1.5 }}>
        {icon}
        <Typography variant="h6" sx={{ fontWeight: 800 }}>
          {title}
        </Typography>
      </Stack>
      <Typography color="text.secondary" sx={{ lineHeight: 1.7, mb: 3, flex: 1 }}>
        {text}
      </Typography>
      <Button variant="contained" onClick={onClick} sx={{ textTransform: 'none', fontWeight: 700, alignSelf: 'flex-start' }}>
        {actionLabel}
      </Button>
    </CardContent>
  </Card>
);

export default DocsHome;
