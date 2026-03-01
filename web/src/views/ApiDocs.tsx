import React, { useState } from 'react';
import {
  Box,
  Paper,
  Typography,
  Chip,
  Button,
  TextField,
  Alert,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Divider,
} from '@mui/material';
import { Lock, Play, Copy } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';

const ENDPOINTS = [
  {
    method: 'GET',
    path: '/api/v1/signals/current',
    auth: 'None (rate-limited)',
    description: 'Latest signal snapshot: CORE_ON, MACRO_ON, all scores, BTC price, timestamp.',
  },
  {
    method: 'GET',
    path: '/api/v1/signals/history',
    auth: 'API Key (Pro)',
    description: 'Full daily signal history. Query params: from, to (YYYY-MM-DD).',
  },
];

const ApiDocs: React.FC = () => {
  const { tier, profile } = useAuth();
  const hasApiAccess = tier === 'pro' || tier === 'pro_plus';
  const [selectedEndpoint, setSelectedEndpoint] = useState(ENDPOINTS[0]);
  const [response, setResponse] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleTry = async () => {
    setLoading(true);
    setResponse(null);
    try {
      const headers: Record<string, string> = {};
      if (profile?.api_key && selectedEndpoint.path.includes('history')) {
        headers['X-API-Key'] = profile.api_key;
      }
      const res = await fetch(selectedEndpoint.path, { headers });
      const data = await res.json();
      setResponse(JSON.stringify(data, null, 2));
    } catch (err: any) {
      setResponse(JSON.stringify({ error: err.message }, null, 2));
    }
    setLoading(false);
  };

  const curlExample = selectedEndpoint.path.includes('history')
    ? `curl -H "X-API-Key: YOUR_API_KEY" https://coinstrat.xyz${selectedEndpoint.path}`
    : `curl https://coinstrat.xyz${selectedEndpoint.path}`;

  const handleCopy = () => {
    navigator.clipboard.writeText(curlExample);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Box sx={{ maxWidth: 800, mx: 'auto' }}>
      <Typography variant="h5" sx={{ fontWeight: 900, mb: 1 }}>Signal API</Typography>
      <Typography color="text.secondary" sx={{ mb: 4 }}>
        Programmatic access to CoinStrat signals. Use API keys for authenticated endpoints.
      </Typography>

      {!hasApiAccess && (
        <Alert severity="info" icon={<Lock size={18} />} sx={{ mb: 3 }}>
          API access requires a Pro or Pro+ subscription. The free <code>/signals/current</code> endpoint is available to everyone.
        </Alert>
      )}

      {/* Endpoints table */}
      <Paper sx={{ mb: 4 }}>
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell sx={{ fontWeight: 700 }}>Method</TableCell>
                <TableCell sx={{ fontWeight: 700 }}>Endpoint</TableCell>
                <TableCell sx={{ fontWeight: 700 }}>Auth</TableCell>
                <TableCell sx={{ fontWeight: 700 }}>Description</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {ENDPOINTS.map((ep) => (
                <TableRow
                  key={ep.path}
                  hover
                  selected={selectedEndpoint.path === ep.path}
                  onClick={() => setSelectedEndpoint(ep)}
                  sx={{ cursor: 'pointer' }}
                >
                  <TableCell>
                    <Chip label={ep.method} size="small" sx={{ fontWeight: 700, fontFamily: 'monospace', fontSize: 11, bgcolor: '#22c55e22', color: '#22c55e' }} />
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2" sx={{ fontFamily: 'monospace', fontSize: 13 }}>{ep.path}</Typography>
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2" color="text.secondary">{ep.auth}</Typography>
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2" color="text.secondary">{ep.description}</Typography>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>

      {/* Playground */}
      <Paper sx={{ p: 3 }}>
        <Typography variant="h6" sx={{ fontWeight: 800, mb: 2 }}>Playground</Typography>

        <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 2 }}>
          <Chip label={selectedEndpoint.method} size="small" sx={{ fontWeight: 700, fontFamily: 'monospace', bgcolor: '#22c55e22', color: '#22c55e' }} />
          <Typography sx={{ fontFamily: 'monospace', fontSize: 14, fontWeight: 600 }}>
            {selectedEndpoint.path}
          </Typography>
        </Stack>

        {/* cURL example */}
        <Box sx={{ mb: 2, position: 'relative' }}>
          <TextField
            value={curlExample}
            fullWidth
            size="small"
            InputProps={{
              readOnly: true,
              sx: { fontFamily: 'monospace', fontSize: 12, bgcolor: 'background.default' },
            }}
          />
          <Button
            size="small"
            onClick={handleCopy}
            startIcon={<Copy size={14} />}
            sx={{
              position: 'absolute',
              right: 4,
              top: 4,
              textTransform: 'none',
              fontSize: 11,
              minWidth: 0,
            }}
          >
            {copied ? 'Copied' : 'Copy'}
          </Button>
        </Box>

        <Button
          variant="contained"
          onClick={handleTry}
          disabled={loading}
          startIcon={<Play size={16} />}
          sx={{ textTransform: 'none', fontWeight: 700, mb: 2 }}
        >
          {loading ? 'Loading…' : 'Send request'}
        </Button>

        {response && (
          <>
            <Divider sx={{ my: 2 }} />
            <Typography variant="body2" sx={{ fontWeight: 700, mb: 1 }}>Response</Typography>
            <Box
              sx={{
                bgcolor: 'background.default',
                borderRadius: 1,
                p: 2,
                maxHeight: 400,
                overflow: 'auto',
                border: '1px solid',
                borderColor: 'divider',
              }}
            >
              <pre style={{ margin: 0, fontSize: 12, fontFamily: 'monospace', whiteSpace: 'pre-wrap' }}>
                {response}
              </pre>
            </Box>
          </>
        )}
      </Paper>

      {/* Authentication section */}
      <Paper sx={{ p: 3, mt: 3 }}>
        <Typography variant="h6" sx={{ fontWeight: 800, mb: 2 }}>Authentication</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Authenticated endpoints require an API key passed in the <code>X-API-Key</code> header.
          You can find your API key on your Profile page after upgrading to Pro.
        </Typography>

        <Typography variant="body2" sx={{ fontFamily: 'monospace', fontSize: 13, bgcolor: 'background.default', p: 2, borderRadius: 1, border: '1px solid', borderColor: 'divider' }}>
          {`curl -H "X-API-Key: cs_abc123..." https://coinstrat.xyz/api/v1/signals/history`}
        </Typography>

        <Divider sx={{ my: 2 }} />

        <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>Rate Limits</Typography>
        <TableContainer>
          <Table size="small">
            <TableBody>
              <TableRow>
                <TableCell sx={{ fontWeight: 600 }}>Free (no key)</TableCell>
                <TableCell color="text.secondary">100 calls/day — <code>/signals/current</code> only</TableCell>
              </TableRow>
              <TableRow>
                <TableCell sx={{ fontWeight: 600 }}>Pro</TableCell>
                <TableCell color="text.secondary">1,000 calls/day — all endpoints</TableCell>
              </TableRow>
              <TableRow>
                <TableCell sx={{ fontWeight: 600 }}>Pro+</TableCell>
                <TableCell color="text.secondary">10,000 calls/day — all endpoints + webhooks</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>
    </Box>
  );
};

export default ApiDocs;
