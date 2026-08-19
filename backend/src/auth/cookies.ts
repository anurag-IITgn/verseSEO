import { SESSION_COOKIE_NAME, SESSION_TTL_MS } from './session.js';

export function parseCookieHeader(header: string | undefined): Record<string, string> {
  const cookies: Record<string, string> = {};
  if (!header) return cookies;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    const name = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (name) {
      try {
        cookies[name] = decodeURIComponent(value);
      } catch {
        cookies[name] = value;
      }
    }
  }
  return cookies;
}

export function setSessionCookie(secure: boolean, token: string, sameSite: 'lax' | 'strict' | 'none' = 'lax'): string {
  const sameSiteAttr = sameSite === 'lax' ? 'SameSite=Lax' : sameSite === 'strict' ? 'SameSite=Strict' : 'SameSite=None';
  return `${SESSION_COOKIE_NAME}=${token}; Path=/; HttpOnly; ${sameSiteAttr}; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}${secure ? '; Secure' : ''}`;
}

export function clearSessionCookie(secure: boolean, sameSite: 'lax' | 'strict' | 'none' = 'lax'): string {
  const sameSiteAttr = sameSite === 'lax' ? 'SameSite=Lax' : sameSite === 'strict' ? 'SameSite=Strict' : 'SameSite=None';
  return `${SESSION_COOKIE_NAME}=; Path=/; HttpOnly; ${sameSiteAttr}; Max-Age=0${secure ? '; Secure' : ''}`;
}