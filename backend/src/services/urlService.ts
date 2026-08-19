import { AppError } from '../utils/errors.js';

export interface NormalizedUrl {
  websiteUrl: string;
  domain: string;
}

export function validateAndNormalizeUrl(input: string): NormalizedUrl {
  if (typeof input !== 'string' || input.trim() === '') {
    throw new AppError(400, 'Website URL is required', 'INVALID_URL');
  }

  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw new AppError(400, 'Invalid website URL', 'INVALID_URL');
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new AppError(400, 'Website URL must use HTTP or HTTPS', 'INVALID_URL');
  }

  if (url.username !== '' || url.password !== '') {
    throw new AppError(400, 'Website URL must not contain credentials', 'INVALID_URL');
  }

  if (url.hostname === '' || url.hostname.includes(' ')) {
    throw new AppError(400, 'Invalid website URL', 'INVALID_URL');
  }

  const pathname = url.pathname.replace(/\/+$/, '');
  const websiteUrl = `${url.protocol}//${url.host}${pathname}`;
  const domain = url.hostname.replace(/^www\./, '');

  return { websiteUrl, domain };
}