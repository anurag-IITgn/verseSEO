const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ reducedMotion: 'no-preference' });
  const page = await context.newPage();
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto('http://localhost:4321', { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(1000);

  const container = await page.$('.modules-scroll-container');
  const containerBox = await container.boundingBox();
  const scrollHeight = await page.evaluate(() => document.querySelector('.modules-scroll-container').scrollHeight);
  const scrollable = scrollHeight - 768;

  for (const [label, progress] of [['Module 4', 0.58], ['Module 5', 0.76]]) {
    const scrollTo = containerBox.y + (scrollable * progress);
    await page.evaluate((y) => window.scrollTo(0, y), scrollTo);
    await page.waitForTimeout(600);

    const cta = await page.$eval('.modules-card.active .modules-card-cta', el => {
      const r = el.getBoundingClientRect();
      return { bottom: r.bottom, text: el.textContent.trim() };
    });

    console.log(`${label} CTA bottom: ${cta.bottom}px`);
  }

  await browser.close();
})();
