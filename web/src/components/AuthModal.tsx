import React, { useState } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  TextField,
  Button,
  Divider,
  Typography,
  Alert,
  Box,
  Tabs,
  Tab,
  IconButton,
} from '@mui/material';
import { X as CloseIcon } from 'lucide-react';
import { supabase } from '../lib/supabase';

interface Props {
  open: boolean;
  onClose: () => void;
}

const SITE_URL = import.meta.env.VITE_SITE_URL || window.location.origin;

const AuthModal: React.FC<Props> = ({ open, onClose }) => {
  const [tab, setTab] = useState<'login' | 'register'>('login');
  const [method, setMethod] = useState<'magic' | 'password'>('magic');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const resetState = () => {
    setMessage(null);
    setError(null);
  };

  const handleMagicLink = async () => {
    if (!supabase) return;
    setLoading(true);
    resetState();
    const { error: err } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${SITE_URL}/dashboard` },
    });
    setLoading(false);
    if (err) {
      setError(err.message);
    } else {
      setMessage('Check your email for the login link.');
    }
  };

  const handlePasswordAuth = async () => {
    if (!supabase) return;
    setLoading(true);
    resetState();

    if (tab === 'register') {
      const { error: err } = await supabase.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: `${SITE_URL}/dashboard` },
      });
      setLoading(false);
      if (err) {
        setError(err.message);
      } else {
        setMessage('Check your email to confirm your account.');
      }
    } else {
      const { error: err } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      setLoading(false);
      if (err) {
        setError(err.message);
      } else {
        onClose();
      }
    }
  };

  const handleOAuth = async (provider: 'google' | 'github') => {
    if (!supabase) return;
    resetState();
    const { error: err } = await supabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo: `${SITE_URL}/dashboard` },
    });
    if (err) setError(err.message);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (method === 'magic') {
      handleMagicLink();
    } else {
      handlePasswordAuth();
    }
  };

  if (!supabase) return null;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="xs"
      fullWidth
      PaperProps={{
        sx: { bgcolor: 'background.paper', backgroundImage: 'none' },
      }}
    >
      <DialogTitle sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Typography variant="h6" sx={{ fontWeight: 800 }}>
          {tab === 'login' ? 'Welcome back' : 'Create account'}
        </Typography>
        <IconButton onClick={onClose} size="small">
          <CloseIcon size={18} />
        </IconButton>
      </DialogTitle>

      <DialogContent>
        <Tabs
          value={tab}
          onChange={(_, v) => { setTab(v); resetState(); }}
          sx={{ mb: 2 }}
          variant="fullWidth"
        >
          <Tab label="Login" value="login" />
          <Tab label="Register" value="register" />
        </Tabs>

        {/* OAuth buttons */}
        <Box sx={{ display: 'flex', gap: 1, mb: 2 }}>
          <Button
            variant="outlined"
            fullWidth
            onClick={() => handleOAuth('google')}
            sx={{ textTransform: 'none', fontWeight: 600 }}
          >
            Google
          </Button>
          <Button
            variant="outlined"
            fullWidth
            onClick={() => handleOAuth('github')}
            sx={{ textTransform: 'none', fontWeight: 600 }}
          >
            GitHub
          </Button>
        </Box>

        <Divider sx={{ my: 2 }}>
          <Typography variant="caption" color="text.secondary">or with email</Typography>
        </Divider>

        {/* Method toggle */}
        <Box sx={{ display: 'flex', gap: 1, mb: 2 }}>
          <Button
            size="small"
            variant={method === 'magic' ? 'contained' : 'outlined'}
            onClick={() => { setMethod('magic'); resetState(); }}
            sx={{ textTransform: 'none', flex: 1, fontWeight: 600 }}
          >
            Magic link
          </Button>
          <Button
            size="small"
            variant={method === 'password' ? 'contained' : 'outlined'}
            onClick={() => { setMethod('password'); resetState(); }}
            sx={{ textTransform: 'none', flex: 1, fontWeight: 600 }}
          >
            Password
          </Button>
        </Box>

        <form onSubmit={handleSubmit}>
          <TextField
            label="Email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            fullWidth
            required
            size="small"
            sx={{ mb: 2 }}
          />

          {method === 'password' && (
            <TextField
              label="Password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              fullWidth
              required
              size="small"
              sx={{ mb: 2 }}
              inputProps={{ minLength: 8 }}
            />
          )}

          {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
          {message && <Alert severity="success" sx={{ mb: 2 }}>{message}</Alert>}

          <Button
            type="submit"
            variant="contained"
            fullWidth
            disabled={loading || !email}
            sx={{ textTransform: 'none', fontWeight: 700, py: 1.2 }}
          >
            {loading
              ? 'Please wait…'
              : method === 'magic'
                ? 'Send magic link'
                : tab === 'register'
                  ? 'Create account'
                  : 'Sign in'
            }
          </Button>
        </form>

        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 2, textAlign: 'center' }}>
          By continuing you agree to the CoinStrat{' '}
          <a href="/terms" target="_blank" style={{ color: '#60a5fa' }}>Terms of Service</a>
          {' '}and{' '}
          <a href="/privacy" target="_blank" style={{ color: '#60a5fa' }}>Privacy Policy</a>.
        </Typography>
      </DialogContent>
    </Dialog>
  );
};

export default AuthModal;
