// @ts-check
import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';
import sitemap from '@astrojs/sitemap';

// https://astro.build/config
export default defineConfig({
  site: 'https://verseseo.com',
  integrations: [sitemap({
    filter: (page) => !page.includes('/app') && !page.includes('/login') && !page.includes('/register')
  })],
  vite: {
    plugins: [tailwindcss()]
  }
});