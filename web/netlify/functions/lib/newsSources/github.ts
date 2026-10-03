import { fetchWithTimeout } from '../newsFetch';
import { canonicalizeUrl, toIsoDate } from './dates';
import type { SourceItem } from './types';

const TIMEOUT_MS = 8000;
const RELEASE_REPOS = [
  { owner: 'bitcoin', repo: 'bitcoin', source: 'Bitcoin Core' },
  { owner: 'lightningnetwork', repo: 'lnd', source: 'LND' },
  { owner: 'ElementsProject', repo: 'lightning', source: 'Core Lightning' },
  { owner: 'lightningdevkit', repo: 'rust-lightning', source: 'LDK' },
  { owner: 'btcpayserver', repo: 'btcpayserver', source: 'BTCPay Server' },
  { owner: 'sparrowwallet', repo: 'sparrow', source: 'Sparrow Wallet' },
  { owner: 'bitcoindevkit', repo: 'bdk', source: 'BDK' },
] as const;

function githubHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'CoinStrat Newsletter Bot/1.0',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  const token = process.env.GITHUB_TOKEN?.trim();
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

interface GithubRelease {
  html_url?: string;
  name?: string | null;
  tag_name?: string;
  body?: string | null;
  published_at?: string | null;
  draft?: boolean;
  prerelease?: boolean;
}

interface GithubPull {
  html_url?: string;
  title?: string;
  created_at?: string;
  body?: string | null;
  user?: { login?: string };
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetchWithTimeout(url, { method: 'GET', headers: githubHeaders() }, TIMEOUT_MS);
  if (!response.ok) {
    throw new Error(`GitHub fetch failed: HTTP ${response.status} ${url}`);
  }
  return await response.json() as T;
}

export async function fetchGithubReleases(): Promise<SourceItem[]> {
  const results = await Promise.allSettled(
    RELEASE_REPOS.map(async ({ owner, repo, source }) => {
      const releases = await fetchJson<GithubRelease[]>(
        `https://api.github.com/repos/${owner}/${repo}/releases?per_page=5`,
      );
      return releases
        .filter((release) => !release.draft && release.html_url)
        .map((release): SourceItem => ({
          url: canonicalizeUrl(release.html_url as string),
          title: (release.name || release.tag_name || 'Release').trim(),
          source,
          section: 'development',
          publishedAt: toIsoDate(release.published_at),
          trust: 'primary',
          excerpt: (release.body ?? '').replace(/\s+/g, ' ').trim().slice(0, 700) || undefined,
        }));
    }),
  );

  return results.flatMap((result) => (result.status === 'fulfilled' ? result.value : []));
}

export async function fetchNewBips(): Promise<SourceItem[]> {
  const pulls = await fetchJson<GithubPull[]>(
    'https://api.github.com/repos/bitcoin/bips/pulls?state=open&sort=created&direction=desc&per_page=10',
  );
  return pulls
    .filter((pull) => pull.html_url && pull.title)
    .map((pull): SourceItem => ({
      url: canonicalizeUrl(pull.html_url as string),
      title: pull.title!.trim(),
      source: `BIPs${pull.user?.login ? ` · ${pull.user.login}` : ''}`,
      section: 'development',
      publishedAt: toIsoDate(pull.created_at),
      trust: 'primary',
      excerpt: (pull.body ?? '').replace(/\s+/g, ' ').trim().slice(0, 700) || undefined,
    }));
}

export async function fetchGithubDevelopment(): Promise<SourceItem[]> {
  const [releases, bips] = await Promise.allSettled([fetchGithubReleases(), fetchNewBips()]);
  return [
    ...(releases.status === 'fulfilled' ? releases.value : []),
    ...(bips.status === 'fulfilled' ? bips.value : []),
  ];
}
