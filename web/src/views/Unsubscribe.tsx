import React, { useMemo, useState } from 'react';
import { Alert, Box, Button, Paper, Stack, TextField, Typography } from '@mui/material';
import { MailX } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';

const Unsubscribe: React.FC = () => {
  const [params] = useSearchParams();
  const initialEmail = useMemo(() => params.get('email') ?? '', [params]);
  const [email, setEmail] = useState(initialEmail);
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [message, setMessage] = useState<string | null>(null);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!email) return;

    setStatus('loading');
    setMessage(null);

    try {
      const response = await fetch('/api/email/unsubscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const data = await response.json();

      if (!response.ok) {
        setStatus('error');
        setMessage(data.error ?? 'Unable to unsubscribe.');
        return;
      }

      setStatus('success');
      setMessage('You have been unsubscribed from CoinStrat newsletters.');
    } catch (error: any) {
      setStatus('error');
      setMessage(error.message ?? 'Unable to unsubscribe.');
    }
  };

  return (
    <Box sx={{ maxWidth: 560, mx: 'auto' }}>
      <Paper sx={{ p: { xs: 3, sm: 4 } }}>
        <Stack spacing={2.5}>
          <Stack direction="row" spacing={1.5} alignItems="center">
            <MailX size={26} />
            <Typography variant="h4" sx={{ fontWeight: 900 }}>
              Unsubscribe
            </Typography>
          </Stack>

          <Typography color="text.secondary">
            Enter the email address receiving the CoinStrat Weekly newsletter. We will suppress it from future sends.
          </Typography>

          {status === 'success' && message && (
            <Alert severity="success">{message}</Alert>
          )}
          {status === 'error' && message && (
            <Alert severity="error">{message}</Alert>
          )}

          <Box component="form" onSubmit={handleSubmit}>
            <Stack spacing={1.5}>
              <TextField
                type="email"
                label="Email address"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                fullWidth
                required
              />
              <Button
                type="submit"
                variant="contained"
                disabled={status === 'loading'}
                sx={{ alignSelf: 'flex-start', textTransform: 'none', fontWeight: 700 }}
              >
                {status === 'loading' ? 'Unsubscribing…' : 'Unsubscribe'}
              </Button>
            </Stack>
          </Box>
        </Stack>
      </Paper>
    </Box>
  );
};

export default Unsubscribe;
