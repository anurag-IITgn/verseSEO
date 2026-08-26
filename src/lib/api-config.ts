const envBase: string | undefined = (import.meta as any).env?.PUBLIC_API_BASE_URL;
const isProd = (import.meta as any).env?.MODE === 'production';

if (!envBase && isProd) {
  throw new Error(
    'PUBLIC_API_BASE_URL is required in production builds. ' +
    'Set it in your Cloudflare Pages / hosting dashboard before deploying.'
  );
}

export const API_BASE: string = envBase ?? 'http://localhost:3000';
