import React from 'react';
import { Box, Paper, Typography, Divider } from '@mui/material';

const Section: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <Box sx={{ mb: 4 }}>
    <Typography variant="h6" sx={{ fontWeight: 800, mb: 1.5 }}>{title}</Typography>
    {children}
  </Box>
);

const P: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5, lineHeight: 1.75 }}>{children}</Typography>
);

const Terms: React.FC = () => (
  <Box sx={{ maxWidth: 720, mx: 'auto' }}>
    <Typography variant="h4" sx={{ fontWeight: 900, mb: 1 }}>Terms of Service</Typography>
    <Typography color="text.secondary" sx={{ mb: 1 }}>Last updated: February 3, 2026</Typography>
    <Divider sx={{ mb: 4 }} />

    <Section title="1. Agreement to Terms">
      <P>
        By accessing or using CoinStrat Pro ("the Service"), operated by CoinStrat ("we", "us", "our"),
        you agree to be bound by these Terms of Service. If you do not agree, do not use the Service.
      </P>
    </Section>

    <Section title="2. Description of Service">
      <P>
        CoinStrat Pro is a web-based analytics platform that provides Bitcoin market signals, scores,
        charts, backtesting tools, and a programmatic API. The Service processes publicly available
        macroeconomic and on-chain data to generate informational signals.
      </P>
    </Section>

    <Section title="3. Not Financial Advice">
      <P>
        The signals, scores, charts, and all other information provided by the Service are for
        informational and educational purposes only. Nothing on this platform constitutes financial
        advice, investment advice, trading advice, or any other kind of professional advice.
      </P>
      <P>
        You are solely responsible for your own investment decisions. Past performance of the model
        or backtesting results do not guarantee future results. Cryptocurrency markets are highly
        volatile and you can lose some or all of your investment. Always do your own research and
        consult a qualified financial advisor before making investment decisions.
      </P>
    </Section>

    <Section title="4. Accounts and Registration">
      <P>
        To access certain features, you must create an account. You are responsible for maintaining
        the confidentiality of your account credentials and for all activity under your account.
        You agree to provide accurate and complete information during registration.
      </P>
      <P>
        We reserve the right to suspend or terminate accounts that violate these terms or are used
        for fraudulent or abusive purposes.
      </P>
    </Section>

    <Section title="5. Subscription Plans and Payments">
      <P>
        CoinStrat Pro offers free and paid subscription tiers. Paid subscriptions are billed monthly
        through Stripe. By subscribing to a paid plan, you authorise us to charge your payment method
        on a recurring basis until you cancel.
      </P>
      <P>
        Prices are listed in US Dollars and may change with 30 days' notice. Price changes do not
        affect existing billing periods.
      </P>
    </Section>

    <Section title="6. Cancellation and Refunds">
      <P>
        You may cancel your subscription at any time through your Profile page or the Stripe Customer
        Portal. Upon cancellation, you retain access to paid features until the end of your current
        billing period.
      </P>
      <P>
        Refunds are handled on a case-by-case basis. If you believe you were charged in error,
        contact us at support@coinstrat.xyz within 14 days of the charge.
      </P>
    </Section>

    <Section title="7. API Usage">
      <P>
        API access is subject to rate limits based on your subscription tier. You may not resell,
        redistribute, or sublicense API access. Automated usage must respect rate limits and must
        not interfere with the Service's availability for other users.
      </P>
      <P>
        We reserve the right to revoke API keys that are used in violation of these terms or that
        generate excessive load.
      </P>
    </Section>

    <Section title="8. Intellectual Property">
      <P>
        All content, code, design, and branding of the Service are the property of CoinStrat.
        You may not copy, modify, distribute, or reverse-engineer any part of the Service without
        prior written permission.
      </P>
      <P>
        Data retrieved through the API may be used for personal or internal business purposes only.
        Public redistribution of signal data requires a separate licensing agreement.
      </P>
    </Section>

    <Section title="9. Limitation of Liability">
      <P>
        To the maximum extent permitted by law, CoinStrat and its operators shall not be liable for
        any indirect, incidental, special, consequential, or punitive damages, including but not
        limited to loss of profits, data, or investment value, arising out of your use of the Service.
      </P>
      <P>
        The Service is provided "as is" and "as available" without warranties of any kind, express or
        implied, including but not limited to warranties of merchantability, fitness for a particular
        purpose, or non-infringement.
      </P>
    </Section>

    <Section title="10. Service Availability">
      <P>
        We strive to maintain high availability but do not guarantee uninterrupted access. The Service
        depends on third-party data providers (including FRED, Blockchain.info, BGeometrics, and Binance)
        whose availability is beyond our control. We are not liable for data delays, gaps, or outages
        caused by third parties.
      </P>
    </Section>

    <Section title="11. Changes to Terms">
      <P>
        We may update these Terms from time to time. Material changes will be communicated via email
        or a prominent notice on the Service. Continued use after changes constitutes acceptance of
        the updated terms.
      </P>
    </Section>

    <Section title="12. Governing Law">
      <P>
        These Terms are governed by and construed in accordance with the laws of England and Wales.
        Any disputes shall be subject to the exclusive jurisdiction of the courts of England and Wales.
      </P>
    </Section>

    <Section title="13. Contact">
      <P>
        For questions about these Terms, contact us at support@coinstrat.xyz.
      </P>
    </Section>
  </Box>
);

export default Terms;
