import React from 'react';
import { Box, Typography, Divider } from '@mui/material';

const Section: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <Box sx={{ mb: 4 }}>
    <Typography variant="h6" sx={{ fontWeight: 800, mb: 1.5 }}>{title}</Typography>
    {children}
  </Box>
);

const P: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5, lineHeight: 1.75 }}>{children}</Typography>
);

const BulletList: React.FC<{ items: string[] }> = ({ items }) => (
  <Box component="ul" sx={{ pl: 3, mb: 1.5 }}>
    {items.map((item) => (
      <Typography component="li" variant="body2" color="text.secondary" key={item} sx={{ mb: 0.5, lineHeight: 1.75 }}>
        {item}
      </Typography>
    ))}
  </Box>
);

const Privacy: React.FC = () => (
  <Box sx={{ maxWidth: 720, mx: 'auto' }}>
    <Typography variant="h4" sx={{ fontWeight: 900, mb: 1 }}>Privacy Policy</Typography>
    <Typography color="text.secondary" sx={{ mb: 1 }}>Last updated: February 3, 2026</Typography>
    <Divider sx={{ mb: 4 }} />

    <Section title="1. Introduction">
      <P>
        CoinStrat ("we", "us", "our") respects your privacy. This Privacy Policy explains what
        information we collect, how we use it, and your rights regarding your personal data when
        you use CoinStrat Pro ("the Service") at coinstrat.xyz.
      </P>
    </Section>

    <Section title="2. Information We Collect">
      <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>Account information</Typography>
      <P>
        When you create an account, we collect your email address and authentication credentials.
        If you sign in via Google or GitHub, we receive your email address and basic profile
        information (name, avatar) from the OAuth provider.
      </P>

      <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>Payment information</Typography>
      <P>
        Payment processing is handled entirely by Stripe. We do not store your credit card number
        or payment details on our servers. We receive and store your Stripe Customer ID and
        subscription status to manage your account tier.
      </P>

      <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>Newsletter subscription</Typography>
      <P>
        If you subscribe to the weekly digest without creating an account, we collect only your
        email address.
      </P>

      <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>Usage data</Typography>
      <P>
        We track API usage (call counts per day) for rate limiting purposes. We do not use
        third-party analytics or tracking tools. We do not sell or share usage data with third parties.
      </P>
    </Section>

    <Section title="3. How We Use Your Information">
      <P>We use the information we collect to:</P>
      <BulletList items={[
        'Provide, maintain, and improve the Service',
        'Manage your account and subscription',
        'Send you the weekly digest email (if subscribed)',
        'Send transactional emails (account verification, password reset, subscription updates)',
        'Enforce rate limits and prevent abuse',
        'Respond to support requests',
      ]} />
    </Section>

    <Section title="4. Third-Party Services">
      <P>We use the following third-party services that may process your data:</P>
      <BulletList items={[
        'Supabase — Authentication and database hosting (stores your account profile)',
        'Stripe — Payment processing (handles all payment data)',
        'Resend — Email delivery (receives your email address to send digest and transactional emails)',
        'Netlify — Hosting and serverless functions',
      ]} />
      <P>
        Each of these services has its own privacy policy. We only share the minimum information
        necessary for each service to function.
      </P>
    </Section>

    <Section title="5. Data Storage and Security">
      <P>
        Your data is stored in Supabase (hosted on AWS infrastructure) with Row Level Security
        policies ensuring users can only access their own data. All data is transmitted over HTTPS.
        API keys are stored as hashed values.
      </P>
      <P>
        While we implement reasonable security measures, no method of transmission or storage is
        100% secure. We cannot guarantee absolute security of your data.
      </P>
    </Section>

    <Section title="6. Data Retention">
      <P>
        We retain your account data for as long as your account is active. If you delete your account,
        we will delete your personal data within 30 days, except where retention is required by law
        or for legitimate business purposes (e.g. payment records for tax compliance).
      </P>
      <P>
        Newsletter subscribers can unsubscribe at any time. Unsubscribed email addresses are marked
        as inactive but retained to prevent re-subscription without consent.
      </P>
    </Section>

    <Section title="7. Your Rights">
      <P>Depending on your jurisdiction, you may have the right to:</P>
      <BulletList items={[
        'Access the personal data we hold about you',
        'Correct inaccurate personal data',
        'Delete your personal data ("right to be forgotten")',
        'Export your data in a portable format',
        'Withdraw consent for marketing emails at any time',
        'Object to processing of your personal data',
      ]} />
      <P>
        To exercise any of these rights, contact us at privacy@coinstrat.xyz. We will respond
        within 30 days.
      </P>
    </Section>

    <Section title="8. Cookies">
      <P>
        We use essential cookies only for authentication session management (Supabase auth tokens
        stored in local storage). We do not use advertising cookies, tracking pixels, or third-party
        analytics cookies.
      </P>
    </Section>

    <Section title="9. Children's Privacy">
      <P>
        The Service is not intended for individuals under the age of 18. We do not knowingly collect
        personal data from children. If you believe a child has provided us with personal data,
        contact us and we will delete it promptly.
      </P>
    </Section>

    <Section title="10. International Data Transfers">
      <P>
        Your data may be processed in countries outside your jurisdiction, including the United States
        (where our hosting providers operate). By using the Service, you consent to such transfers.
        We ensure appropriate safeguards are in place as required by applicable data protection laws.
      </P>
    </Section>

    <Section title="11. Changes to This Policy">
      <P>
        We may update this Privacy Policy from time to time. Material changes will be communicated
        via email or a prominent notice on the Service. The "Last updated" date at the top reflects
        the most recent revision.
      </P>
    </Section>

    <Section title="12. Contact">
      <P>
        For privacy-related questions or requests, contact us at privacy@coinstrat.xyz.
      </P>
    </Section>
  </Box>
);

export default Privacy;
