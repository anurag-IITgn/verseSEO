// @ts-check
import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';
import sitemap from '@astrojs/sitemap';
import { loadEnv } from 'vite';

import cloudflare from '@astrojs/cloudflare';

const mode = process.env.NODE_ENV ?? 'production';
const env = loadEnv(mode, process.cwd(), '');
if (mode === 'production' && !env.PUBLIC_API_BASE_URL) {
  throw new Error(
    'PUBLIC_API_BASE_URL is required in production builds.\n' +
    'Set it in your hosting dashboard (Cloudflare Pages / Render) before deploying.'
  );
}

// https://astro.build/config
export default defineConfig({
  site: 'https://verseseo.com',

  integrations: [sitemap({
    filter: (page) => !page.includes('/app') && !page.includes('/login') && !page.includes('/register') && !page.includes('/verify-email') && !page.includes('/forgot-password') && !page.includes('/reset-password')
  })],

  vite: {
    plugins: [tailwindcss()]
  },

  adapter: cloudflare()
});