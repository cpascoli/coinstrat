import React, { useCallback } from 'react';
import type { Session } from '@supabase/supabase-js';
import { Box, CircularProgress, Paper, Stack, Typography } from '@mui/material';
import { Bot as BotIcon, Shield } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import CqmBotTab from './admin/CqmBotTab';

const Bot: React.FC = () => {
  const { isAdmin, session, loading: authLoading } = useAuth();

  const authHeaders = useCallback((): Record<string, string> => {
    const token = (session as Session | null)?.access_token;
    return token ? { Authorization: `Bearer ${token}` } : {};
  }, [session]);

  if (authLoading) {
    return (
      <Paper sx={{ p: 4, textAlign: 'center' }}>
        <CircularProgress size={28} sx={{ mb: 2 }} />
        <Typography variant="h6" sx={{ fontWeight: 700 }}>Loading</Typography>
        <Typography color="text.secondary">Checking your account permissions…</Typography>
      </Paper>
    );
  }

  if (!isAdmin) {
    return (
      <Paper sx={{ p: 4, textAlign: 'center' }}>
        <Shield size={40} style={{ marginBottom: 12, opacity: 0.5 }} />
        <Typography variant="h6" sx={{ fontWeight: 700 }}>Access denied</Typography>
        <Typography color="text.secondary">You need admin privileges to view this page.</Typography>
      </Paper>
    );
  }

  return (
    <Box>
      <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 3 }}>
        <BotIcon size={24} />
        <Typography variant="h5" sx={{ fontWeight: 900 }}>CQM Bot</Typography>
      </Stack>
      <CqmBotTab authHeaders={authHeaders} />
    </Box>
  );
};

export default Bot;
