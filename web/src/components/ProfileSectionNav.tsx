import React from 'react';
import { Button, Paper, Tab, Tabs } from '@mui/material';

export type ProfileSectionNavItem = {
  id: string;
  label: string;
  icon: React.ReactElement;
};

type ProfileSectionNavProps = {
  items: ProfileSectionNavItem[];
  activeId: string;
  onSelect: (id: string) => void;
  variant: 'desktop' | 'mobile';
};

const ProfileSectionNav: React.FC<ProfileSectionNavProps> = ({
  items,
  activeId,
  onSelect,
  variant,
}) => {
  if (variant === 'mobile') {
    return (
      <Paper
        sx={{
          p: 0.75,
          borderColor: 'rgba(148,163,184,0.22)',
          background: 'rgba(2,6,23,0.32)',
          boxShadow: 'none',
        }}
      >
        <Tabs
          value={activeId}
          onChange={(_, value: string) => onSelect(value)}
          variant="scrollable"
          scrollButtons="auto"
          sx={{ minHeight: 0, '& .MuiTab-root': { minHeight: 0, textTransform: 'none', fontWeight: 700 } }}
        >
          {items.map((item) => (
            <Tab
              key={item.id}
              value={item.id}
              icon={item.icon}
              iconPosition="start"
              label={item.label}
            />
          ))}
        </Tabs>
      </Paper>
    );
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
      {items.map((item) => {
        const active = item.id === activeId;

        return (
          <Button
            key={item.id}
            variant={active ? 'contained' : 'outlined'}
            size="small"
            onClick={() => onSelect(item.id)}
            startIcon={item.icon}
            sx={{
              textTransform: 'none',
              fontWeight: 700,
              justifyContent: 'flex-start',
              px: 1.5,
              py: 1,
              mb: 1,
              '&:last-of-type': { mb: 0 },
            }}
            fullWidth
          >
            {item.label}
          </Button>
        );
      })}
    </Paper>
  );
};

export default ProfileSectionNav;
