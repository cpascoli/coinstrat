import { serviceSupabase } from './auth';

/**
 * Shared AI image generation + storage used by the daily news article and the
 * weekly newsletter. Generates a pop-art illustration from a content-derived
 * prompt, uploads it to a public Supabase Storage bucket under a unique path
 * (so a regenerated image is never served stale by the CDN), and returns the
 * public URL. Best-effort: returns null on any failure and never throws.
 */

const openAiApiKey = process.env.OPENAI_API_KEY;
const imageModel = process.env.OPENAI_IMAGE_MODEL || 'gpt-image-1';
const imageQuality = process.env.OPENAI_IMAGE_QUALITY || 'medium';
const IMAGE_SIZE = '1536x1024';
const IMAGE_BUCKET = process.env.NEWS_IMAGE_BUCKET || 'news-images';
const DEFAULT_TIMEOUT_MS = 45000;

// Image models render text/logos/people poorly and fabricated charts look
// misleading, so we exclude them and pin a consistent pop-art metaphor style.
export const POP_ART_IMAGE_STYLE =
  'Bold pop art style: vivid saturated colors, halftone dots, strong outlines, high-contrast comic-book aesthetic. The image must be a single sophisticated visual metaphor for the one key takeaway of the story. No Bitcoin or cryptocurrency coin logos or coin symbols. No text, no words, no letters, no numbers, no brand logos, no charts, no graphs, no identifiable real people.';

export interface GeneratedImage {
  url: string;
  alt: string;
  path: string;
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

function compact(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

export function storagePathFromPublicUrl(url: string | null): string | null {
  if (!url) return null;
  const marker = `/object/public/${IMAGE_BUCKET}/`;
  const idx = url.indexOf(marker);
  if (idx === -1) return null;
  const rest = url.slice(idx + marker.length).split('?')[0];
  return rest || null;
}

export async function generateAndStoreImage(opts: {
  pathPrefix: string;
  prompt: string;
  alt: string;
  fallbackSubject: string;
  style?: string;
  timeoutMs?: number;
}): Promise<GeneratedImage | null> {
  if (!openAiApiKey) return null;

  const style = opts.style ?? POP_ART_IMAGE_STYLE;
  const basePrompt = (opts.prompt || `A sophisticated visual metaphor for the key takeaway of: ${opts.fallbackSubject}`).trim();
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  // gpt-image-1 always returns b64 and rejects `response_format`; dall-e-3 needs
  // `response_format: 'b64_json'` and a different size/quality vocabulary.
  const isDallE = imageModel.includes('dall-e');
  const requestBody = isDallE
    ? {
        model: imageModel,
        prompt: `${basePrompt}\n\nStyle: ${style}`,
        size: '1792x1024',
        quality: imageQuality === 'high' ? 'hd' : 'standard',
        response_format: 'b64_json',
        n: 1,
      }
    : {
        model: imageModel,
        prompt: `${basePrompt}\n\nStyle: ${style}`,
        size: IMAGE_SIZE,
        quality: imageQuality,
        n: 1,
      };

  try {
    const response = await fetchWithTimeout('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${openAiApiKey}`,
      },
      body: JSON.stringify(requestBody),
    }, timeoutMs);

    if (!response.ok) {
      console.error('[aiImage] OpenAI HTTP', response.status, compact(await response.text()).slice(0, 300));
      return null;
    }

    const json = await response.json() as any;
    const b64 = json?.data?.[0]?.b64_json;
    if (typeof b64 !== 'string' || !b64) {
      console.error('[aiImage] no image data returned');
      return null;
    }

    const bytes = Buffer.from(b64, 'base64');
    // Unique path per generation so the storage CDN never serves a stale image.
    const path = `${opts.pathPrefix}-${Date.now()}.png`;

    const { error: uploadError } = await serviceSupabase.storage
      .from(IMAGE_BUCKET)
      .upload(path, bytes, { contentType: 'image/png', upsert: true, cacheControl: '31536000' });

    if (uploadError) {
      console.error('[aiImage] upload failed', uploadError.message);
      return null;
    }

    const { data } = serviceSupabase.storage.from(IMAGE_BUCKET).getPublicUrl(path);
    const url = data?.publicUrl;
    if (!url) return null;

    return { url, alt: opts.alt || opts.fallbackSubject, path };
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      console.error(`[aiImage] timed out after ${timeoutMs}ms`);
    } else {
      console.error('[aiImage]', error);
    }
    return null;
  }
}

/** Best-effort cleanup of a previously stored image (skips the path we just wrote). */
export async function removeStoredImage(previousUrl: string | null, keepPath?: string | null): Promise<void> {
  const previousPath = storagePathFromPublicUrl(previousUrl);
  if (previousPath && previousPath !== keepPath) {
    const { error } = await serviceSupabase.storage.from(IMAGE_BUCKET).remove([previousPath]);
    if (error) console.warn('[aiImage] previous image cleanup failed', error.message);
  }
}
