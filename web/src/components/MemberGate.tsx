import React from 'react';
import { Box, Button, CircularProgress, Paper, Typography } from '@mui/material';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

interface Props {
  onOpenAuth?: () => void;
  children: React.ReactNode;
}

/**
 * Gates member-only content (e.g. a model's Signals/Scores tabs) using the same
 * policy as the top-level dashboard route: requires a verified, Free-access user.
 */
const MemberGate: React.FC<Props> = ({ onOpenAuth, children }) => {
  const { loading, isAuthenticated, isVerified, hasFreeAccess } = useAuth();
  const navigate = useNavigate();

  if (loading) {
    return (
      <Paper sx={{ p: 3 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <CircularProgress size={22} />
          <Typography sx={{ fontWeight: 800 }}>Checking access…</Typography>
        </Box>
      </Paper>
    );
  }

  if (!isAuthenticated) {
    return (
      <Paper sx={{ p: 3 }}>
        <Typography sx={{ fontWeight: 900, mb: 1.5 }}>Sign in to unlock CoinStrat Free</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Signal analysis and scoring are available to signed-in Free members.
        </Typography>
        <Box sx={{ display: 'flex', gap: 1.25, flexWrap: 'wrap' }}>
          <Button variant="contained" onClick={() => onOpenAuth?.()} sx={{ fontWeight: 700 }}>
            Sign in or create account
          </Button>
          <Button variant="outlined" onClick={() => navigate('/docs')} sx={{ fontWeight: 700 }}>
            Learn more first
          </Button>
        </Box>
      </Paper>
    );
  }

  if (!hasFreeAccess || !isVerified) {
    return (
      <Paper sx={{ p: 3 }}>
        <Typography sx={{ fontWeight: 900, mb: 1.5 }}>Verify your email to unlock CoinStrat Free</Typography>
        <Typography variant="body2" color="text.secondary">
          Password signups need email confirmation before access is enabled. Magic-link and OAuth users
          are unlocked automatically.
        </Typography>
      </Paper>
    );
  }

  return <>{children}</>;
};

export default MemberGate;
