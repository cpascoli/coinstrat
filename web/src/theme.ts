import { createTheme } from '@mui/material/styles';
import { alpha } from '@mui/material/styles';

export const theme = createTheme({
  palette: {
    mode: 'light',
    primary: { main: '#2563eb' }, // blue-600-ish
    background: {
      default: '#f8fafc', // slate-50-ish
      paper: '#ffffff',
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
          border: `1px solid ${alpha('#0f172a', 0.08)}`,
        },
      },
    },
    MuiAppBar: {
      styleOverrides: {
        root: {
          boxShadow: 'none',
          borderBottom: `1px solid ${alpha('#0f172a', 0.08)}`,
        },
      },
    },
  },
});


