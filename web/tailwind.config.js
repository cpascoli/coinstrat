/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  // Beat MUI Emotion/CssBaseline on specificity; all app UI lives under #root.
  important: '#root',
  // MUI CssBaseline + Tailwind preflight fight (double reset, broken typography).
  corePlugins: {
    preflight: false,
  },
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        surface: '#0c1322',
        'on-background': '#dce2f7',
        'surface-container-lowest': '#070e1d',
        'on-secondary': '#003919',
        tertiary: '#ffafd3',
        'on-primary': '#002a78',
        'tertiary-container': '#b74082',
        'surface-container': '#191f2f',
        'primary-container': '#2563eb',
        'on-surface-variant': '#c3c6d7',
        secondary: '#4de082',
        outline: '#8d90a0',
        'surface-container-high': '#232a3a',
        'surface-container-highest': '#2e3545',
        'on-primary-container': '#eeefff',
        'on-surface': '#dce2f7',
        'outline-variant': '#434655',
        'surface-container-low': '#141b2b',
        'primary-fixed': '#dbe1ff',
        background: '#0c1322',
        primary: '#b4c5ff',
        'inverse-primary': '#0053db',
        'secondary-container': '#00b55d',
        'on-tertiary': '#620040',
      },
      fontFamily: {
        headline: ['"Plus Jakarta Sans"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        body: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        label: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        '3xl': '0 35px 60px -15px rgba(0, 0, 0, 0.35)',
      },
    },
  },
  plugins: [],
};
