import type { GscConfig } from './config.js';
import { GscUnavailableError } from './errors.js';

export const GSC_SCOPE = 'https://www.googleapis.com/auth/webmasters.readonly';
const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const TIMEOUT_MS = 10_000;

export function buildGscAuthUrl(config: GscConfig, state: string): string {
  const url = new URL(AUTH_URL);
  url.searchParams.set('client_id', config.clientId);
  url.searchParams.set('redirect_uri', config.redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', GSC_SCOPE);
  url.searchParams.set('access_type', 'offline');
  url.searchParams.set('prompt', 'consent');
  url.searchParams.set('state', state);
  return url.toString();
}

export interface GscTokenResult {
  accessToken: string;
  refreshToken: string | null;
  expiresIn: number;
}

async function postTokenRequest(config: GscConfig, body: URLSearchParams): Promise<GscTokenResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64')}`,
      },
      body: body.toString(),
    });
    if (!res.ok) {
      throw new GscUnavailableError('HTTP', `Google OAuth token request failed (HTTP ${res.status}).`);
    }
    const payload = (await res.json()) as { access_token?: unknown; refresh_token?: unknown; expires_in?: unknown };
    if (typeof payload.access_token !== 'string' || payload.access_token === '') {
      throw new GscUnavailableError('INVALID_RESPONSE', 'Google OAuth token request returned no access token.');
    }
    return {
      accessToken: payload.access_token,
      refreshToken: typeof payload.refresh_token === 'string' && payload.refresh_token !== '' ? payload.refresh_token : null,
      expiresIn: typeof payload.expires_in === 'number' && Number.isFinite(payload.expires_in) ? payload.expires_in : 3600,
    };
  } catch (error) {
    if (error instanceof GscUnavailableError) throw error;
    if (controller.signal.aborted) throw new GscUnavailableError('TIMEOUT', 'Google OAuth token request timed out.');
    throw new GscUnavailableError('NETWORK', `Google OAuth token request failed: ${error instanceof Error ? error.message : 'unknown error'}`);
  } finally {
    clearTimeout(timeout);
  }
}

export async function exchangeGscCode(config: GscConfig, code: string): Promise<GscTokenResult> {
  const body = new URLSearchParams({
    code,
    client_id: config.clientId,
    client_secret: config.clientSecret,
    redirect_uri: config.redirectUri,
    grant_type: 'authorization_code',
  });
  const result = await postTokenRequest(config, body);
  if (!result.refreshToken) {
    throw new GscUnavailableError('INVALID_RESPONSE', 'Google OAuth did not return a refresh token (offline access was not granted).');
  }
  return result;
}

export async function refreshGscAccessToken(config: GscConfig, refreshToken: string): Promise<GscTokenResult> {
  const body = new URLSearchParams({
    refresh_token: refreshToken,
    client_id: config.clientId,
    client_secret: config.clientSecret,
    grant_type: 'refresh_token',
  });
  return postTokenRequest(config, body);
}