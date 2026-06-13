import React from 'react';
import { Box, Button, Link as MuiLink, Paper, Typography } from '@mui/material';
import { Link as RouterLink, Navigate, Route, Routes, useParams } from 'react-router-dom';
import { LineChart } from 'lucide-react';
import type { SignalData } from '../../App';
import ChartsView from '../ChartsView';
import { INDICATOR_CATEGORIES, getIndicatorCategory } from '../../indicators/registry';

interface AreaProps {
  data: SignalData[];
}

const IndicatorsCatalog: React.FC = () => (
  <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, pb: 1.5, borderBottom: '1px solid', borderColor: 'divider' }}>
      <LineChart className="h-8 w-8 text-blue-600" />
      <Box>
        <Typography variant="h4" sx={{ fontWeight: 900, letterSpacing: -0.5 }}>Indicators</Typography>
        <Typography variant="body2" color="text.secondary">
          The shared market-lens charts the models read from. Browse by category.
        </Typography>
      </Box>
    </Box>

    <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' } }}>
      {INDICATOR_CATEGORIES.map((cat) => (
        <Paper key={cat.id} sx={{ p: 2.5, display: 'flex', flexDirection: 'column', gap: 1 }}>
          <Typography variant="h6" sx={{ fontWeight: 800 }}>{cat.label}</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ flex: 1 }}>{cat.blurb}</Typography>
          <Button component={RouterLink} to={`/indicators/${cat.id}`} variant="contained" sx={{ mt: 1, alignSelf: 'flex-start', fontWeight: 700 }}>
            Open
          </Button>
        </Paper>
      ))}
    </Box>
  </Box>
);

const IndicatorCategory: React.FC<AreaProps> = ({ data }) => {
  const { categoryId } = useParams();
  const cat = getIndicatorCategory(categoryId);
  if (!cat) return <Navigate to="/indicators" replace />;

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, pb: 1.5, borderBottom: '1px solid', borderColor: 'divider', flexWrap: 'wrap' }}>
        <LineChart className="h-7 w-7 text-blue-500" />
        <Box>
          <MuiLink component={RouterLink} to="/indicators" sx={{ fontSize: 12, fontWeight: 700 }}>Indicators</MuiLink>
          <Typography variant="h4" sx={{ fontWeight: 900, letterSpacing: -0.5 }}>{cat.label}</Typography>
        </Box>
      </Box>
      <ChartsView data={data} sections={[cat.section]} embedded />
    </Box>
  );
};

const IndicatorsArea: React.FC<AreaProps> = ({ data }) => (
  <Routes>
    <Route index element={<IndicatorsCatalog />} />
    <Route path=":categoryId" element={<IndicatorCategory data={data} />} />
    <Route path="*" element={<Navigate to="/indicators" replace />} />
  </Routes>
);

export default IndicatorsArea;
