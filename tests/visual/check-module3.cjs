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
  const scrollTo = containerBox.y + (scrollable * 0.4);
  await page.evaluate((y) => window.scrollTo(0, y), scrollTo);
  await page.waitForTimeout(600);

  const card = await page.$eval('.modules-card.active', el => {
    const r = el.getBoundingClientRect();
    return { top: r.top, bottom: r.bottom, height: r.height };
  });
  const shell = await page.$eval('.modules-card.active .modules-card-shell', el => {
    const r = el.getBoundingClientRect();
    return { top: r.top, bottom: r.bottom, height: r.height };
  });
  const cta = await page.$eval('.modules-card.active .modules-card-cta', el => {
    const r = el.getBoundingClientRect();
    return { top: r.top, bottom: r.bottom, height: r.height, text: el.textContent.trim() };
  });
  const bullets = await page.$eval('.modules-card.active .modules-card-bullets', el => {
    const r = el.getBoundingClientRect();
    return { top: r.top, bottom: r.bottom, height: r.height };
  });

  console.log('Viewport: 768px');
  console.log('Card:', JSON.stringify(card));
  console.log('Shell:', JSON.stringify(shell));
  console.log('Bullets:', JSON.stringify(bullets));
  console.log('CTA:', JSON.stringify(cta));
  console.log('Card bottom vs viewport:', card.bottom <= 768 ? 'FITS' : 'OVERFLOWS by ' + (card.bottom - 768) + 'px');
  console.log('CTA bottom vs viewport:', cta.bottom <= 768 ? 'FITS' : 'OVERFLOWS by ' + (cta.bottom - 768) + 'px');

  await browser.close();
})();
