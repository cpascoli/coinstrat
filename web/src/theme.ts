import { createTheme } from '@mui/material/styles';
import { alpha } from '@mui/material/styles';

export const theme = createTheme({
  palette: {
    mode: 'dark',
    primary: { main: '#60a5fa' }, // blue-400-ish (pops on dark)
    secondary: { main: '#a78bfa' }, // violet-400-ish
    background: {
      default: '#0b1220', // deep slate/navy
      paper: '#0f172a', // slate-900-ish
    },
    text: {
      primary: '#e5e7eb', // gray-200
      secondary: '#94a3b8', // slate-400
    },
  },
  shape: { borderRadius: 14 },
  typography: {
    // Use a modern system stack so we don't have to ship Roboto.
    fontFamily:
      'ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, "Apple Color Emoji", "Segoe UI Emoji"',
  },
  components: {
    MuiPaper: {
      styleOverrides: {
        root: {
          border: `1px solid ${alpha('#e5e7eb', 0.10)}`,
        },
      },
    },
    MuiAppBar: {
      styleOverrides: {
        root: {
          boxShadow: 'none',
          borderBottom: `1px solid ${alpha('#e5e7eb', 0.10)}`,
        },
      },
    },
    MuiCssBaseline: {
      styleOverrides: {
        body: {
          backgroundColor: '#0b1220',
        },
      },
    },
  },
});


