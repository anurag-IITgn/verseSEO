// @ts-check
import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';
import sitemap from '@astrojs/sitemap';

import cloudflare from '@astrojs/cloudflare';

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