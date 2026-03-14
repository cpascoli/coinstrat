import React from 'react';
import { Box } from '@mui/material';
import DocsSectionNav from './DocsSectionNav';

const DocsPageLayout: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  return (
    <Box sx={{ maxWidth: 1180, mx: 'auto' }}>
      <Box
        sx={{
          display: { xs: 'block', md: 'grid' },
          gridTemplateColumns: { md: '220px minmax(0, 1fr)' },
          gap: { md: 3, lg: 4 },
          alignItems: 'start',
        }}
      >
        <Box sx={{ display: { xs: 'none', md: 'block' } }}>
          <Box sx={{ position: 'sticky', top: 88 }}>
            <DocsSectionNav />
          </Box>
        </Box>
        <Box sx={{ maxWidth: 920, width: '100%' }}>
          {children}
        </Box>
      </Box>
    </Box>
  );
};

export default DocsPageLayout;
