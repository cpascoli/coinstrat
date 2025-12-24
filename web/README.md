# Power Wallet 2026 Web Dashboard

This is a React/TypeScript translation of the Power Wallet Pre-Accumulation Model, running live in the browser.

## Features
- **Live Data Fetching**: Fetches data from FRED (Macro), Binance (BTC Price Tail), and Blockchain.info (MVRV).
- **Hybrid BTC History**: Uses a local JSON file for historical BTC data combined with a live Binance API tail for the most recent points.
- **On-the-fly Computation**: Replicates the Python logic (moving averages, state machines, scoring) in TypeScript.
- **Interactive Analytics**: Recharts-powered BTC price history with US Liquidity overlays.

## Setup & Configuration

### 1. API Keys
The dashboard requires a FRED API Key. Create a `.env` file in the `web/` directory:
```bash
VITE_FRED_API_KEY=your_fred_api_key_here
```

### 2. CORS Considerations
The FRED API and some others do not support CORS requests directly from the browser. 
- **Development**: Use a browser extension to bypass CORS or configure Vite proxy.
- **Production**: Deploy with Netlify Functions or a similar serverless proxy to handle API requests securely and bypass CORS.

### 3. Install & Run
```bash
cd web
npm install
npm run dev
```
Open [http://localhost:3000](http://localhost:3000) in your browser.

## Tech Stack
- React + TypeScript
- Vite (Build Tool)
- Tailwind CSS (Styling)
- Recharts (Data Visualization)
- Lucide React (Iconography)

