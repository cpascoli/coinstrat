import { Alert } from '@mui/material';
import {
  type CoinbaseGbpCheck,
  coinbaseGbpWarningText,
} from '../../utils/cqmBotCashCheck';

export function CoinbaseGbpWarningAlert({ check }: { check: CoinbaseGbpCheck }) {
  const text = coinbaseGbpWarningText(check);
  if (!text) return null;
  return (
    <Alert
      severity={check.status === 'short_for_buy' ? 'error' : 'warning'}
      role="alert"
    >
      {text}
    </Alert>
  );
}
