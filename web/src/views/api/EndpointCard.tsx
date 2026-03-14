import React, { useCallback, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  Collapse,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { ChevronDown, Play, Copy } from 'lucide-react';
import type { Endpoint, ParamField } from './endpoints';

const METHOD_COLOR: Record<string, string> = {
  GET: '#22c55e',
  POST: '#60a5fa',
  PUT: '#f59e0b',
  DELETE: '#ef4444',
};

interface Props {
  ep: Endpoint;
  apiKey: string;
  sessionToken?: string | null;
}

const EndpointCard: React.FC<Props> = ({ ep, apiKey, sessionToken }) => {
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState<Record<string, string>>({});
  const [response, setResponse] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  const queryParams = useMemo(
    () => (ep.params ?? []).filter((p) => p.in === 'query'),
    [ep.params],
  );
  const pathParams = useMemo(
    () => (ep.params ?? []).filter((p) => p.in === 'path'),
    [ep.params],
  );

  const set = useCallback(
    (name: string, value: string) =>
      setValues((prev) => ({ ...prev, [name]: value })),
    [],
  );

  const resolvedPath = useMemo(() => {
    let path = ep.path;
    for (const p of pathParams) {
      const v = values[p.name] || p.placeholder || `:${p.name}`;
      path = path.replace(`:${p.name}`, encodeURIComponent(v));
    }
    const qs = queryParams
      .map((p) => {
        const v = values[p.name];
        return v ? `${p.name}=${encodeURIComponent(v)}` : null;
      })
      .filter(Boolean)
      .join('&');
    return qs ? `${path}?${qs}` : path;
  }, [ep.path, pathParams, queryParams, values]);

  const curl = useMemo(() => {
    const parts = [`curl -X ${ep.method} https://coinstrat.xyz${resolvedPath}`];
    if (ep.auth === 'api_key') {
      const key = apiKey || '<YOUR_API_KEY>';
      parts.push(`  -H "X-API-Key: ${key}"`);
    } else if (ep.auth === 'admin_jwt') {
      parts.push(`  -H "Authorization: Bearer <YOUR_SESSION_JWT>"`);
    } else if (ep.auth === 'cron_secret') {
      parts.push(`  -H "Authorization: Bearer <CRON_SECRET>"`);
    }
    return parts.join(' \\\n');
  }, [ep.method, ep.auth, resolvedPath, apiKey]);

  const send = useCallback(async () => {
    setLoading(true);
    setResponse(null);
    try {
      const headers: Record<string, string> = {};
      if (ep.auth === 'api_key' && apiKey) {
        headers['X-API-Key'] = apiKey;
      }
      if (ep.auth === 'admin_jwt' && sessionToken) {
        headers.Authorization = `Bearer ${sessionToken}`;
      }
      const res = await fetch(resolvedPath, { method: ep.method, headers });
      const text = await res.text();
      try {
        setResponse(JSON.stringify(JSON.parse(text), null, 2));
      } catch {
        setResponse(text);
      }
    } catch (err) {
      setResponse(`Error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setLoading(false);
    }
  }, [ep.method, ep.auth, resolvedPath, apiKey, sessionToken]);

  const copyCurl = useCallback(async () => {
    await navigator.clipboard.writeText(curl);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  }, [curl]);

  const authLabel =
    ep.auth === 'none'
      ? 'Public'
      : ep.auth === 'api_key'
        ? 'API Key'
        : ep.auth === 'admin_jwt'
          ? 'Admin Session'
        : 'Cron Secret';

  const cannotSend =
    ep.auth === 'cron_secret'
    || (ep.auth === 'api_key' && !apiKey)
    || (ep.auth === 'admin_jwt' && !sessionToken);

  const disabledReason =
    ep.auth === 'cron_secret'
      ? 'Server-to-server only'
      : ep.auth === 'api_key' && !apiKey
        ? 'API key required'
        : ep.auth === 'admin_jwt' && !sessionToken
          ? 'Admin session required'
          : null;

  const mc = METHOD_COLOR[ep.method] ?? '#94a3b8';

  return (
    <Box
      sx={{
        border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: 3,
        overflow: 'hidden',
        transition: 'border-color 0.15s',
        '&:hover': { borderColor: 'rgba(255,255,255,0.15)' },
      }}
    >
      {/* Header */}
      <Box
        onClick={() => setOpen((o) => !o)}
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1.5,
          px: 2,
          py: 1.5,
          cursor: 'pointer',
          userSelect: 'none',
          bgcolor: 'rgba(0,0,0,0.22)',
          '&:hover': { bgcolor: 'rgba(0,0,0,0.30)' },
        }}
      >
        <Chip
          label={ep.method}
          size="small"
          sx={{
            fontWeight: 900,
            fontSize: 11,
            letterSpacing: 0.5,
            bgcolor: `${mc}22`,
            color: mc,
            border: `1px solid ${mc}55`,
            minWidth: 56,
          }}
        />
        <Typography
          component="code"
          sx={{
            fontFamily: 'monospace',
            fontSize: 13.5,
            fontWeight: 600,
            flex: 1,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {ep.path}
        </Typography>
        <Typography
          variant="body2"
          sx={{ color: 'text.secondary', display: { xs: 'none', sm: 'block' }, whiteSpace: 'nowrap' }}
        >
          {ep.summary}
        </Typography>
        <ChevronDown
          size={18}
          style={{
            transition: 'transform 0.2s',
            transform: open ? 'rotate(180deg)' : 'none',
            color: '#94a3b8',
            flexShrink: 0,
          }}
        />
      </Box>

      {/* Expanded content */}
      <Collapse in={open}>
        <Box sx={{ p: 2.5, pt: 2, borderTop: '1px solid rgba(255,255,255,0.06)' }}>
          <Stack spacing={2}>
            <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
              <Typography variant="body2" sx={{ fontWeight: 700 }}>{ep.summary}</Typography>
              <Chip label={authLabel} size="small" variant="outlined" sx={{ fontSize: 11 }} />
            </Stack>

            {ep.description && (
              <Typography variant="body2" sx={{ color: 'text.secondary' }}>{ep.description}</Typography>
            )}

            {/* Query params */}
            {queryParams.length > 0 && (
              <Stack spacing={1}>
                <Typography variant="body2" sx={{ fontWeight: 700 }}>Query parameters</Typography>
                {queryParams.map((p) => (
                  <ParamInput key={p.name} param={p} value={values[p.name] ?? ''} onChange={set} />
                ))}
              </Stack>
            )}

            {/* Path params */}
            {pathParams.length > 0 && (
              <Stack spacing={1}>
                <Typography variant="body2" sx={{ fontWeight: 700 }}>Path parameters</Typography>
                {pathParams.map((p) => (
                  <ParamInput key={p.name} param={p} value={values[p.name] ?? ''} onChange={set} />
                ))}
              </Stack>
            )}

            {/* Actions */}
            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
              <Button
                variant="contained"
                size="small"
                startIcon={<Play size={14} />}
                onClick={send}
                disabled={loading || cannotSend}
                sx={{ textTransform: 'none', fontWeight: 700 }}
              >
                {loading ? 'Sending...' : 'Send request'}
              </Button>
              <Button
                variant="outlined"
                size="small"
                startIcon={<Copy size={14} />}
                onClick={copyCurl}
                sx={{ textTransform: 'none', fontWeight: 700 }}
              >
                {copied ? 'Copied!' : 'Copy curl'}
              </Button>
            </Stack>

            {disabledReason && (
              <Alert severity="info" sx={{ fontSize: 13 }}>
                {disabledReason}
              </Alert>
            )}

            {/* curl preview */}
            <Box>
              <Typography variant="caption" sx={{ color: 'text.secondary', mb: 0.5, display: 'block' }}>
                curl
              </Typography>
              <Box
                component="pre"
                sx={{
                  m: 0,
                  p: 1.5,
                  borderRadius: 2,
                  bgcolor: 'rgba(0,0,0,0.35)',
                  border: '1px solid rgba(255,255,255,0.06)',
                  overflow: 'auto',
                  fontSize: 12,
                  lineHeight: 1.5,
                  maxHeight: 220,
                }}
              >
                {curl}
              </Box>
            </Box>

            {/* Response */}
            {response !== null && (
              <Box>
                <Typography variant="caption" sx={{ color: 'text.secondary', mb: 0.5, display: 'block' }}>
                  Response
                </Typography>
                {response.startsWith('Error:') ? (
                  <Alert severity="error" sx={{ fontSize: 13 }}>{response}</Alert>
                ) : (
                  <Box
                    component="pre"
                    sx={{
                      m: 0,
                      p: 1.5,
                      borderRadius: 2,
                      bgcolor: 'rgba(0,0,0,0.35)',
                      border: '1px solid rgba(255,255,255,0.06)',
                      overflow: 'auto',
                      fontSize: 12,
                      lineHeight: 1.5,
                      maxHeight: 400,
                    }}
                  >
                    {response}
                  </Box>
                )}
              </Box>
            )}
          </Stack>
        </Box>
      </Collapse>
    </Box>
  );
};

function ParamInput({
  param,
  value,
  onChange,
}: {
  param: ParamField;
  value: string;
  onChange: (name: string, value: string) => void;
}) {
  return (
    <TextField
      size="small"
      fullWidth
      label={`${param.name}${param.required ? ' *' : ''}`}
      placeholder={param.placeholder}
      helperText={param.description}
      value={value}
      onChange={(e) => onChange(param.name, e.target.value)}
      type={param.type === 'number' ? 'number' : undefined}
      sx={{ '& .MuiInputBase-root': { fontFamily: 'monospace', fontSize: 13 } }}
    />
  );
}

export default EndpointCard;
