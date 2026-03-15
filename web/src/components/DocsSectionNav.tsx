import React from 'react';
import { Button, Paper, Stack, Typography } from '@mui/material';
import { useLocation, useNavigate } from 'react-router-dom';
import { Activity, BarChart3, Binary, BookOpen, Database, Workflow } from 'lucide-react';

export type DocsNavItem = {
  label: string;
  path: string;
  icon: React.ReactNode;
};

export const DOCS_NAV_ITEMS: DocsNavItem[] = [
  { label: 'Docs Home', path: '/docs', icon: <BookOpen size={16} /> },
  { label: 'Architecture', path: '/docs/architecture', icon: <Activity size={16} /> },
  { label: 'Data Feeds', path: '/docs/data', icon: <Database size={16} /> },
  { label: 'Scores', path: '/docs/scores', icon: <BarChart3 size={16} /> },
  { label: 'Signals', path: '/docs/signals', icon: <Binary size={16} /> },
  { label: 'Signal Builder', path: '/docs/signal-builder', icon: <Workflow size={16} /> },
];

const DocsSectionNav: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();

  return (
    <Paper
      sx={{
        p: 2,
        borderColor: 'rgba(148,163,184,0.22)',
        background: 'rgba(2,6,23,0.32)',
        boxShadow: 'none',
      }}
    >
      <Stack spacing={1.5}>
        <Stack spacing={1}>
          {DOCS_NAV_ITEMS.map((item) => {
            const active = location.pathname === item.path;

            return (
              <Button
                key={item.path}
                variant={active ? 'contained' : 'outlined'}
                size="small"
                onClick={() => navigate(item.path)}
                startIcon={item.icon}
                sx={{
                  textTransform: 'none',
                  fontWeight: 700,
                  justifyContent: 'flex-start',
                  px: 1.5,
                  py: 1,
                }}
                fullWidth
              >
                {item.label}
              </Button>
            );
          })}
        </Stack>
      </Stack>
    </Paper>
  );
};

export default DocsSectionNav;
