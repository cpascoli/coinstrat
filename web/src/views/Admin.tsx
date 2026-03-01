import React, { useEffect, useState, useCallback } from 'react';
import {
  Box,
  Paper,
  Typography,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Chip,
  Select,
  MenuItem,
  Button,
  Alert,
  Stack,
  CircularProgress,
} from '@mui/material';
import { Shield, Users, Crown, Zap } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { supabase, type Profile, type Tier } from '../lib/supabase';
import type { Session } from '@supabase/supabase-js';

const TIER_COLORS: Record<string, string> = {
  free: '#94a3b8',
  pro: '#60a5fa',
  pro_plus: '#a78bfa',
};

const Admin: React.FC = () => {
  const { isAdmin, session } = useAuth();
  const [users, setUsers] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const authHeaders = useCallback((): Record<string, string> => {
    const token = (session as Session | null)?.access_token;
    return token ? { 'Authorization': `Bearer ${token}` } : {};
  }, [session]);

  const fetchUsers = useCallback(async () => {
    if (!supabase) return;
    setLoading(true);
    const res = await fetch('/api/admin/users', { headers: authHeaders() });
    if (!res.ok) {
      setError('Failed to load users');
      setLoading(false);
      return;
    }
    const data = await res.json();
    setUsers(data.users ?? []);
    setLoading(false);
  }, [authHeaders]);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  if (!isAdmin) {
    return (
      <Paper sx={{ p: 4, textAlign: 'center' }}>
        <Shield size={40} style={{ marginBottom: 12, opacity: 0.5 }} />
        <Typography variant="h6" sx={{ fontWeight: 700 }}>Access denied</Typography>
        <Typography color="text.secondary">You need admin privileges to view this page.</Typography>
      </Paper>
    );
  }

  const tierCounts = {
    total: users.length,
    free: users.filter(u => u.tier === 'free').length,
    pro: users.filter(u => u.tier === 'pro').length,
    pro_plus: users.filter(u => u.tier === 'pro_plus').length,
  };

  const handleTierChange = async (userId: string, newTier: Tier) => {
    setError(null);
    setSuccess(null);
    const res = await fetch('/api/admin/users', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ userId, tier: newTier }),
    });
    if (res.ok) {
      setSuccess(`User tier updated to ${newTier}`);
      setUsers(prev => prev.map(u => u.id === userId ? { ...u, tier: newTier } : u));
    } else {
      setError('Failed to update tier');
    }
  };

  return (
    <Box sx={{ maxWidth: 960, mx: 'auto' }}>
      <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 3 }}>
        <Shield size={24} />
        <Typography variant="h5" sx={{ fontWeight: 900 }}>Admin Dashboard</Typography>
      </Stack>

      {/* Stats */}
      <Stack direction="row" spacing={2} sx={{ mb: 3 }} useFlexGap flexWrap="wrap">
        <StatCard icon={<Users size={20} />} label="Total users" value={tierCounts.total} color="#e5e7eb" />
        <StatCard icon={null} label="Free" value={tierCounts.free} color={TIER_COLORS.free} />
        <StatCard icon={<Zap size={20} />} label="Pro" value={tierCounts.pro} color={TIER_COLORS.pro} />
        <StatCard icon={<Crown size={20} />} label="Pro+" value={tierCounts.pro_plus} color={TIER_COLORS.pro_plus} />
      </Stack>

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
      {success && <Alert severity="success" sx={{ mb: 2 }}>{success}</Alert>}

      {/* Users table */}
      <Paper>
        {loading ? (
          <Box sx={{ p: 4, textAlign: 'center' }}>
            <CircularProgress size={24} />
          </Box>
        ) : (
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell sx={{ fontWeight: 700 }}>Email</TableCell>
                  <TableCell sx={{ fontWeight: 700 }}>Tier</TableCell>
                  <TableCell sx={{ fontWeight: 700 }}>Stripe</TableCell>
                  <TableCell sx={{ fontWeight: 700 }}>Joined</TableCell>
                  <TableCell sx={{ fontWeight: 700 }}>Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {users.map((u) => (
                  <TableRow key={u.id}>
                    <TableCell>
                      <Typography variant="body2" sx={{ fontFamily: 'monospace', fontSize: 13 }}>
                        {u.email}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Chip
                        label={u.tier}
                        size="small"
                        sx={{
                          bgcolor: `${TIER_COLORS[u.tier] ?? '#94a3b8'}22`,
                          color: TIER_COLORS[u.tier] ?? '#94a3b8',
                          fontWeight: 700,
                          fontSize: 11,
                        }}
                      />
                    </TableCell>
                    <TableCell>
                      <Typography variant="caption" color="text.secondary" sx={{ fontFamily: 'monospace' }}>
                        {u.stripe_customer_id ? u.stripe_customer_id.slice(0, 18) + '…' : '—'}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Typography variant="caption" color="text.secondary">
                        {new Date(u.created_at).toLocaleDateString()}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Select
                        size="small"
                        value={u.tier}
                        onChange={(e) => handleTierChange(u.id, e.target.value as Tier)}
                        sx={{ fontSize: 12, minWidth: 100 }}
                      >
                        <MenuItem value="free">free</MenuItem>
                        <MenuItem value="pro">pro</MenuItem>
                        <MenuItem value="pro_plus">pro_plus</MenuItem>
                      </Select>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </Paper>
    </Box>
  );
};

const StatCard: React.FC<{ icon: React.ReactNode; label: string; value: number; color: string }> = ({
  icon, label, value, color,
}) => (
  <Paper sx={{ p: 2, minWidth: 130, flex: '1 1 130px' }}>
    <Stack direction="row" alignItems="center" spacing={0.5} sx={{ mb: 0.5 }}>
      {icon}
      <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600 }}>{label}</Typography>
    </Stack>
    <Typography variant="h4" sx={{ fontWeight: 900, color }}>{value}</Typography>
  </Paper>
);

export default Admin;
