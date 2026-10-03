import { canonicalizeUrl, toIsoDate } from './dates';
import type { SourceItem } from './types';

export const NOSTR_RELAYS = [
  'wss://relay.damus.io',
  'wss://nos.lol',
  'wss://relay.primal.net',
] as const;

const MIN_CONTENT_CHARS = 800;
const QUERY_TIMEOUT_MS = 12000;

export interface NostrEvent {
  id?: string;
  pubkey?: string;
  created_at?: number;
  kind?: number;
  content?: string;
  tags?: string[][];
}

export function nostrTag(event: NostrEvent, name: string): string | undefined {
  return event.tags?.find((tag) => tag[0] === name)?.[1];
}

/**
 * Original publication time. NIP-23 `published_at` wins over the event
 * `created_at` so a re-saved long-form post cannot look new.
 */
export function publishedAtFromNostrEvent(event: NostrEvent): string | null {
  const tagged = nostrTag(event, 'published_at');
  if (tagged) {
    if (/^\d+$/.test(tagged)) {
      const seconds = Number(tagged);
      if (Number.isFinite(seconds) && seconds > 0) {
        return new Date(seconds * 1000).toISOString();
      }
    }
    const iso = toIsoDate(tagged);
    if (iso) return iso;
  }
  if (typeof event.created_at === 'number' && event.created_at > 0) {
    return new Date(event.created_at * 1000).toISOString();
  }
  return null;
}

export function titleFromNostrEvent(event: NostrEvent): string {
  const tagged = nostrTag(event, 'title');
  if (tagged?.trim()) return tagged.trim();
  const firstLine = (event.content ?? '').split(/\n/)[0] ?? '';
  return firstLine.replace(/\s+/g, ' ').trim().slice(0, 160);
}

export function isUsableLongform(
  event: NostrEvent,
  opts: { minChars?: number; allowlist?: ReadonlySet<string> } = {},
): boolean {
  const content = (event.content ?? '').trim();
  const minChars = opts.minChars ?? MIN_CONTENT_CHARS;
  if (content.length < minChars) return false;
  if (opts.allowlist && opts.allowlist.size > 0) {
    const pubkey = (event.pubkey ?? '').toLowerCase();
    if (!pubkey || !opts.allowlist.has(pubkey)) return false;
  }
  return true;
}

function eventUrl(event: NostrEvent): string {
  const tagged = nostrTag(event, 'd');
  if (event.pubkey && tagged) {
    return `https://njump.me/${event.pubkey}/${encodeURIComponent(tagged)}`;
  }
  if (event.id) return `https://njump.me/${event.id}`;
  return '';
}

export function sourceItemFromNostrEvent(event: NostrEvent, section: SourceItem['section'] = 'culture'): SourceItem | null {
  if (!isUsableLongform(event)) return null;
  const url = eventUrl(event);
  const title = titleFromNostrEvent(event);
  if (!url || !title) return null;
  const pubkey = event.pubkey ? `${event.pubkey.slice(0, 8)}…` : 'unknown';
  return {
    url: canonicalizeUrl(url),
    title,
    source: `Nostr · ${pubkey}`,
    section,
    publishedAt: publishedAtFromNostrEvent(event),
    trust: 'secondary',
    excerpt: (event.content ?? '').replace(/\s+/g, ' ').trim().slice(0, 700),
  };
}

function queryRelay(relay: string, sinceSeconds: number): Promise<NostrEvent[]> {
  const WebSocketCtor = (globalThis as { WebSocket?: new (url: string) => WebSocket }).WebSocket;
  if (!WebSocketCtor) return Promise.resolve([]);

  return new Promise((resolve) => {
    const events: NostrEvent[] = [];
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      try { socket.close(); } catch { /* ignore */ }
      resolve(events);
    };

    let socket: WebSocket;
    try {
      socket = new WebSocketCtor(relay);
    } catch {
      resolve([]);
      return;
    }

    const timer = setTimeout(finish, QUERY_TIMEOUT_MS);
    socket.addEventListener('open', () => {
      socket.send(JSON.stringify(['REQ', 'csnews', {
        kinds: [30023],
        '#t': ['bitcoin'],
        since: sinceSeconds,
        limit: 200,
      }]));
    });
    socket.addEventListener('message', (message) => {
      try {
        const data = JSON.parse(String((message as MessageEvent).data)) as unknown[];
        if (data[0] === 'EVENT' && data[2] && typeof data[2] === 'object') {
          events.push(data[2] as NostrEvent);
        }
        if (data[0] === 'EOSE') {
          clearTimeout(timer);
          finish();
        }
      } catch { /* ignore malformed frames */ }
    });
    socket.addEventListener('error', () => {
      clearTimeout(timer);
      finish();
    });
    socket.addEventListener('close', () => {
      clearTimeout(timer);
      finish();
    });
  });
}

export async function fetchNostrLongform(lookbackMs: number): Promise<SourceItem[]> {
  const sinceSeconds = Math.floor((Date.now() - lookbackMs) / 1000);
  const batches = await Promise.allSettled(NOSTR_RELAYS.map((relay) => queryRelay(relay, sinceSeconds)));
  const byId = new Map<string, NostrEvent>();
  for (const batch of batches) {
    if (batch.status !== 'fulfilled') continue;
    for (const event of batch.value) {
      const key = event.id || `${event.pubkey}:${nostrTag(event, 'd')}:${event.created_at}`;
      if (key && !byId.has(key)) byId.set(key, event);
    }
  }

  const items: SourceItem[] = [];
  for (const event of byId.values()) {
    const culture = sourceItemFromNostrEvent(event, 'culture');
    if (culture) items.push(culture);
  }
  return items;
}
