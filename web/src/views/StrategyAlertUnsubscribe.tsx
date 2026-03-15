import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Box, Button, Paper, Stack, Typography } from '@mui/material';
import { BellOff } from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';

const StrategyAlertUnsubscribe: React.FC = () => {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const token = useMemo(() => params.get('token') ?? '', [params]);
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>(token ? 'loading' : 'error');
  const [message, setMessage] = useState<string>('Processing your strategy alert unsubscribe request…');

  useEffect(() => {
    if (!token) {
      setStatus('error');
      setMessage('Missing strategy alert unsubscribe token.');
      return;
    }

    let cancelled = false;

    fetch(`/api/email/strategy-alerts/unsubscribe?token=${encodeURIComponent(token)}`)
      .then(async (response) => {
        const data = await response.json();
        if (cancelled) return;
        if (!response.ok) {
          setStatus('error');
          setMessage(data.error ?? 'Unable to unsubscribe strategy alerts.');
          return;
        }
        setStatus('success');
        setMessage(`Custom strategy alerts have been disabled for ${data.email}.`);
      })
      .catch((error: Error) => {
        if (cancelled) return;
        setStatus('error');
        setMessage(error.message || 'Unable to unsubscribe strategy alerts.');
      });

    return () => {
      cancelled = true;
    };
  }, [token]);

  return (
    <Box sx={{ maxWidth: 560, mx: 'auto' }}>
      <Paper sx={{ p: { xs: 3, sm: 4 } }}>
        <Stack spacing={2.5}>
          <Stack direction="row" spacing={1.5} alignItems="center">
            <BellOff size={26} />
            <Typography variant="h4" sx={{ fontWeight: 900 }}>
              Strategy Alert Preferences
            </Typography>
          </Stack>

          <Typography color="text.secondary">
            Custom strategy alerts are separate from both the weekly newsletter and the fixed CoinStrat signal alerts.
          </Typography>

          {status === 'loading' && <Alert severity="info">{message}</Alert>}
          {status === 'success' && <Alert severity="success">{message}</Alert>}
          {status === 'error' && <Alert severity="error">{message}</Alert>}

          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.25}>
            <Button variant="contained" onClick={() => navigate('/strategy-builder')} sx={{ textTransform: 'none', fontWeight: 700 }}>
              Open strategy builder
            </Button>
            <Button variant="outlined" onClick={() => navigate('/')} sx={{ textTransform: 'none', fontWeight: 700 }}>
              Back to home
            </Button>
          </Stack>
        </Stack>
      </Paper>
    </Box>
  );
};

export default StrategyAlertUnsubscribe;
