import React, { useMemo } from 'react';
import { Box, Button, Paper, Stack, Typography } from '@mui/material';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { DOCS_NAV_ITEMS } from './DocsSectionNav';

const DocsPager: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();

  const { previousItem, nextItem } = useMemo(() => {
    const currentIndex = DOCS_NAV_ITEMS.findIndex((item) => item.path === location.pathname);

    if (currentIndex === -1) {
      return { previousItem: null, nextItem: null };
    }

    return {
      previousItem: currentIndex > 0 ? DOCS_NAV_ITEMS[currentIndex - 1] : null,
      nextItem: currentIndex < DOCS_NAV_ITEMS.length - 1 ? DOCS_NAV_ITEMS[currentIndex + 1] : null,
    };
  }, [location.pathname]);

  if (!previousItem && !nextItem) {
    return null;
  }

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
        <Typography variant="overline" color="text.secondary">
          Continue Reading
        </Typography>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 1.5, flexWrap: 'wrap' }}>
          <Box>
            {previousItem && (
              <Button
                variant="outlined"
                startIcon={<ArrowLeft size={16} />}
                onClick={() => navigate(previousItem.path)}
                sx={{ textTransform: 'none', fontWeight: 700 }}
              >
                {previousItem.label}
              </Button>
            )}
          </Box>
          <Box sx={{ ml: 'auto' }}>
            {nextItem && (
              <Button
                variant="contained"
                endIcon={<ArrowRight size={16} />}
                onClick={() => navigate(nextItem.path)}
                sx={{ textTransform: 'none', fontWeight: 700 }}
              >
                {nextItem.label}
              </Button>
            )}
          </Box>
        </Box>
      </Stack>
    </Paper>
  );
};

export default DocsPager;
