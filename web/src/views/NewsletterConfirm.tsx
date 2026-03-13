import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Box, Button, Paper, Stack, Typography } from '@mui/material';
import { MailCheck } from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';

const NewsletterConfirm: React.FC = () => {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const token = useMemo(() => params.get('token') ?? '', [params]);
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>(token ? 'loading' : 'error');
  const [message, setMessage] = useState<string>(
    token ? 'Confirming your subscription…' : 'Missing confirmation token.',
  );

  useEffect(() => {
    if (!token) return;

    let cancelled = false;

    const run = async () => {
      try {
        const response = await fetch(`/api/email/confirm?token=${encodeURIComponent(token)}`);
        const data = await response.json();

        if (cancelled) return;

        if (!response.ok) {
          setStatus('error');
          setMessage(data.error ?? 'Unable to confirm your subscription.');
          return;
        }

        setStatus('success');
        setMessage('Your email is confirmed. You are now subscribed to the CoinStrat Weekly Signal Report.');
      } catch (error: any) {
        if (cancelled) return;
        setStatus('error');
        setMessage(error.message ?? 'Unable to confirm your subscription.');
      }
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, [token]);

  return (
    <Box sx={{ maxWidth: 620, mx: 'auto' }}>
      <Paper sx={{ p: { xs: 3, sm: 4 } }}>
        <Stack spacing={2.5}>
          <Stack direction="row" spacing={1.5} alignItems="center">
            <MailCheck size={26} />
            <Typography variant="h4" sx={{ fontWeight: 900 }}>
              Confirm Newsletter
            </Typography>
          </Stack>

          <Typography color="text.secondary">
            Confirm your email to activate the CoinStrat Weekly Signal Report. Once confirmed, you
            will receive the weekly digest and can unsubscribe at any time from the footer of any
            newsletter email.
          </Typography>

          {status === 'loading' && <Alert severity="info">{message}</Alert>}
          {status === 'success' && <Alert severity="success">{message}</Alert>}
          {status === 'error' && <Alert severity="error">{message}</Alert>}

          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
            <Button variant="contained" onClick={() => navigate('/')} sx={{ textTransform: 'none', fontWeight: 700 }}>
              Back to Home
            </Button>
            <Button variant="outlined" onClick={() => navigate('/dashboard')} sx={{ textTransform: 'none', fontWeight: 700 }}>
              Open Dashboard
            </Button>
          </Stack>
        </Stack>
      </Paper>
    </Box>
  );
};

export default NewsletterConfirm;
