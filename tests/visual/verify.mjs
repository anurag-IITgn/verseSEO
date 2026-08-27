/**
 * Visual Verification Script for VerseSEO ModulesExperience
 * 
 * Connects to running dev server at http://localhost:4321
 * Captures screenshots and verifies layout geometry.
 * 
 * Usage: node tests/visual/verify.mjs
 */

import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';

const DEV_URL = 'http://localhost:4321';
const SCREENSHOT_DIR = join(process.cwd(), 'screenshots');

// Ensure screenshots directory exists
mkdirSync(SCREENSHOT_DIR, { recursive: true });

const results = {
  passed: [],
  failed: [],
  screenshots: [],
  boundingBoxes: []
};

function assert(condition, name, details = {}) {
  if (condition) {
    results.passed.push(name);
    console.log(`  ✓ ${name}`);
  } else {
    const failure = { name, ...details };
    results.failed.push(failure);
    console.log(`  ✗ ${name}`);
    if (details.expected) console.log(`    Expected: ${details.expected}`);
    if (details.actual) console.log(`    Actual: ${details.actual}`);
    if (details.boundingBox) console.log(`    Bounding box: ${JSON.stringify(details.boundingBox)}`);
    if (details.viewport) console.log(`    Viewport: ${details.viewport}`);
    if (details.scrollPosition !== undefined) console.log(`    Scroll position: ${details.scrollPosition}`);
  }
}

async function captureScreenshot(page, name, viewport, fullPage = false) {
  const filename = `${name}-${viewport.width}x${viewport.height}.png`;
  const filepath = join(SCREENSHOT_DIR, filename);
  await page.screenshot({ 
    path: filepath, 
    fullPage,
    timeout: 60000
  });
  results.screenshots.push(filename);
  console.log(`  📸 Screenshot: ${filename}`);
  return filepath;
}

async function getBoundingBox(page, selector) {
  try {
    const element = await page.$(selector);
    if (!element) return null;
    return await element.boundingBox();
  } catch {
    return null;
  }
}

async function verifyDesktop(page) {
  console.log('\n═══════════════════════════════════════════════');
  console.log('  DESKTOP VERIFICATION (1366x768)');
  console.log('═══════════════════════════════════════════════\n');

  const viewport = { width: 1366, height: 768 };
  await page.setViewportSize(viewport);
  await page.goto(DEV_URL, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(1000);

  // Screenshot: initial load
  await captureScreenshot(page, 'desktop-initial', viewport);

  // Get page dimensions
  const pageHeight = await page.evaluate(() => document.documentElement.scrollHeight);
  const pageWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  console.log(`  Page dimensions: ${pageWidth}x${pageHeight}`);

  // 1. No horizontal overflow
  assert(
    pageWidth <= viewport.width,
    'No horizontal page overflow',
    {
      expected: `page width <= ${viewport.width}`,
      actual: `page width = ${pageWidth}`,
      viewport: `${viewport.width}x${viewport.height}`
    }
  );

  // Get ModulesExperience section
  const section = await getBoundingBox(page, '.modules-experience');
  console.log(`\n  ModulesExperience section bounding box: ${JSON.stringify(section)}`);
  results.boundingBoxes.push({ selector: '.modules-experience', bbox: section, viewport });

  if (!section) {
    console.log('  ⚠ Could not find .modules-experience section');
    return;
  }

  // 2. Section fits within viewport width
  assert(
    section.x >= 0 && section.x + section.width <= viewport.width + 1,
    'Section fits within viewport width',
    {
      expected: `section right edge <= ${viewport.width}`,
      actual: `section right edge = ${section.x + section.width}`,
      boundingBox: section,
      viewport: `${viewport.width}x${viewport.height}`
    }
  );

  // Get presentation
  const presentation = await getBoundingBox(page, '.modules-presentation');
  console.log(`  Presentation bounding box: ${JSON.stringify(presentation)}`);
  results.boundingBoxes.push({ selector: '.modules-presentation', bbox: presentation, viewport });

  if (!presentation) {
    console.log('  ⚠ Could not find .modules-presentation');
    return;
  }

  // 3. Presentation fits within viewport width
  assert(
    presentation.x >= 0 && presentation.x + presentation.width <= viewport.width + 1,
    'Presentation fits within viewport width',
    {
      expected: `presentation right edge <= ${viewport.width}`,
      actual: `presentation right edge = ${presentation.x + presentation.width}`,
      boundingBox: presentation,
      viewport: `${viewport.width}x${viewport.height}`
    }
  );

  // 4. Presentation height does not exceed viewport (should use natural height)
  assert(
    presentation.height <= viewport.height + 1,
    'Presentation height does not exceed viewport',
    {
      expected: `presentation height <= ${viewport.height}`,
      actual: `presentation height = ${presentation.height}`,
      boundingBox: presentation,
      viewport: `${viewport.width}x${viewport.height}`
    }
  );

  // Check active module card
  const activeCard = await getBoundingBox(page, '.modules-card.active');
  console.log(`  Active card bounding box: ${JSON.stringify(activeCard)}`);
  results.boundingBoxes.push({ selector: '.modules-card.active', bbox: activeCard, viewport });

  if (activeCard) {
    // 5. Active card right edge within viewport
    assert(
      activeCard.x + activeCard.width <= viewport.width + 1,
      'Active card fits within viewport width',
      {
        expected: `card right edge <= ${viewport.width}`,
        actual: `card right edge = ${activeCard.x + activeCard.width}`,
        boundingBox: activeCard,
        viewport: `${viewport.width}x${viewport.height}`
      }
    );

    // 6. Active card bottom edge within viewport
    assert(
      activeCard.y + activeCard.height <= viewport.height + 1,
      'Active card fits within viewport height',
      {
        expected: `card bottom edge <= ${viewport.height}`,
        actual: `card bottom edge = ${activeCard.y + activeCard.height}`,
        boundingBox: activeCard,
        viewport: `${viewport.width}x${viewport.height}`
      }
    );
  }

  // Check card shell
  const cardShell = await getBoundingBox(page, '.modules-card.active .modules-card-shell');
  console.log(`  Card shell bounding box: ${JSON.stringify(cardShell)}`);
  results.boundingBoxes.push({ selector: '.modules-card.active .modules-card-shell', bbox: cardShell, viewport });

  // Check mockup
  const mockup = await getBoundingBox(page, '.modules-card.active .modules-card-mockup');
  console.log(`  Mockup bounding box: ${JSON.stringify(mockup)}`);
  results.boundingBoxes.push({ selector: '.modules-card.active .modules-card-mockup', bbox: mockup, viewport });

  // 7. Check for internal scrollbars in mockup
  const hasInternalScroll = await page.evaluate(() => {
    const mockup = document.querySelector('.modules-card.active .modules-card-mockup');
    if (!mockup) return false;
    return mockup.scrollHeight > mockup.clientHeight || mockup.scrollWidth > mockup.clientWidth;
  });
  assert(
    !hasInternalScroll,
    'No internal scrollbar in mockup',
    {
      expected: 'mockup scrollHeight <= clientHeight',
      actual: hasInternalScroll ? 'mockup has internal scroll' : 'no internal scroll',
      viewport: `${viewport.width}x${viewport.height}`
    }
  );

  // Check GrowthGraph (section after ModulesExperience)
  const growthGraph = await getBoundingBox(page, '#modules + section, #modules ~ section:first-of-type');
  console.log(`  Following section (GrowthGraph) bounding box: ${JSON.stringify(growthGraph)}`);
  results.boundingBoxes.push({ selector: 'following section', bbox: growthGraph, viewport });

  if (growthGraph && section) {
    // 8. Module 05 does not overlap following section
    const sectionBottom = section.y + section.height;
    const growthGraphTop = growthGraph.y;
    assert(
      sectionBottom <= growthGraphTop + 1,
      'ModulesExperience does not overlap following section',
      {
        expected: `section bottom (${sectionBottom}) <= following section top (${growthGraphTop})`,
        actual: `section bottom = ${sectionBottom}, following section top = ${growthGraphTop}`,
        boundingBox: { sectionBottom, growthGraphTop },
        viewport: `${viewport.width}x${viewport.height}`
      }
    );
  }

  // Scroll through ModulesExperience and test each module
  console.log('\n  --- Scrolling through modules ---');
  
  const scrollContainer = await page.$('.modules-scroll-container');
  if (scrollContainer) {
    const containerBox = await scrollContainer.boundingBox();
    const scrollHeight = await page.evaluate(() => {
      const container = document.querySelector('.modules-scroll-container');
      return container ? container.scrollHeight : 0;
    });
    console.log(`  Scroll container height: ${scrollHeight}`);
    console.log(`  Container bounding box: ${JSON.stringify(containerBox)}`);
    
    // Calculate scroll positions for each module (0-4)
    // The scroll container starts after the intro, so we use containerBox.y
    const scrollableDistance = scrollHeight - viewport.height;
    const moduleThresholds = [0.05, 0.22, 0.40, 0.58, 0.76];
    
    for (let i = 0; i < 5; i++) {
      const scrollProgress = moduleThresholds[i];
      // Scroll to container start + scrollable distance * progress
      const scrollTo = containerBox.y + (scrollableDistance * scrollProgress);
      
      await page.evaluate((y) => window.scrollTo(0, y), scrollTo);
      await page.waitForTimeout(600); // Wait for transition
      
      // Check which module is active
      const activeModule = await page.evaluate(() => {
        const cards = document.querySelectorAll('.modules-card');
        for (let j = 0; j < cards.length; j++) {
          if (cards[j].classList.contains('active')) return j;
        }
        return -1;
      });
      
      const currentScroll = await page.evaluate(() => window.scrollY);
      
      assert(
        activeModule === i,
        `Module ${i + 1} is active at scroll progress ${scrollProgress}`,
        {
          expected: `active module = ${i}`,
          actual: `active module = ${activeModule}`,
          scrollPosition: currentScroll,
          viewport: `${viewport.width}x${viewport.height}`
        }
      );
      
      // Get active card at this scroll position
      const activeCardAtScroll = await getBoundingBox(page, '.modules-card.active');
      if (activeCardAtScroll) {
        console.log(`  Module ${i + 1} card bbox: ${JSON.stringify(activeCardAtScroll)}`);
        
        // Check card is within viewport
        assert(
          activeCardAtScroll.y >= 0 && activeCardAtScroll.y + activeCardAtScroll.height <= viewport.height + 50,
          `Module ${i + 1} card visible in viewport`,
          {
            expected: `card within viewport bounds`,
            actual: `card top=${activeCardAtScroll.y}, bottom=${activeCardAtScroll.y + activeCardAtScroll.height}`,
            scrollPosition: currentScroll,
            viewport: `${viewport.width}x${viewport.height}`
          }
        );
      }
      
      await captureScreenshot(page, `desktop-module-${i + 1}`, viewport);
    }
  }
}

async function verifyMobile(page) {
  console.log('\n═══════════════════════════════════════════════');
  console.log('  MOBILE VERIFICATION (390x844)');
  console.log('═══════════════════════════════════════════════\n');

  const viewport = { width: 390, height: 844 };
  await page.setViewportSize(viewport);
  await page.goto(DEV_URL, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(1000);

  // Screenshot: initial load
  await captureScreenshot(page, 'mobile-initial', viewport);

  // Get page dimensions
  const pageHeight = await page.evaluate(() => document.documentElement.scrollHeight);
  const pageWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  console.log(`  Page dimensions: ${pageWidth}x${pageHeight}`);

  // 1. No horizontal overflow
  assert(
    pageWidth <= viewport.width + 1,
    'No horizontal page overflow (mobile)',
    {
      expected: `page width <= ${viewport.width}`,
      actual: `page width = ${pageWidth}`,
      viewport: `${viewport.width}x${viewport.height}`
    }
  );

  // Check modules-presentation is NOT sticky on mobile
  const presentationPosition = await page.evaluate(() => {
    const el = document.querySelector('.modules-presentation');
    if (!el) return 'not found';
    return window.getComputedStyle(el).position;
  });
  
  assert(
    presentationPosition === 'relative' || presentationPosition === 'static',
    'Presentation is not sticky on mobile',
    {
      expected: 'position: relative or static',
      actual: `position: ${presentationPosition}`,
      viewport: `${viewport.width}x${viewport.height}`
    }
  );

  // Check all cards are visible (stacked)
  const allCardsVisible = await page.evaluate(() => {
    const cards = document.querySelectorAll('.modules-card');
    let visibleCount = 0;
    cards.forEach(card => {
      const style = window.getComputedStyle(card);
      if (style.display !== 'none') visibleCount++;
    });
    return visibleCount;
  });

  assert(
    allCardsVisible === 5,
    'All 5 module cards are visible on mobile',
    {
      expected: '5 visible cards',
      actual: `${allCardsVisible} visible cards`,
      viewport: `${viewport.width}x${viewport.height}`
    }
  );

  // Check for internal scrollbars in any mockup
  const hasInternalScroll = await page.evaluate(() => {
    const mockups = document.querySelectorAll('.modules-card-mockup');
    for (const mockup of mockups) {
      if (mockup.scrollHeight > mockup.clientHeight || mockup.scrollWidth > mockup.clientWidth) {
        return true;
      }
    }
    return false;
  });

  assert(
    !hasInternalScroll,
    'No internal scrollbar in any mobile mockup',
    {
      expected: 'all mockups fit without scroll',
      actual: hasInternalScroll ? 'at least one mockup has internal scroll' : 'no internal scroll',
      viewport: `${viewport.width}x${viewport.height}`
    }
  );

  // Scroll through page to check all content is accessible
  console.log('\n  --- Scrolling through mobile page ---');
  
  const scrollPositions = [0, 0.25, 0.5, 0.75, 1.0];
  for (const progress of scrollPositions) {
    const scrollTo = (pageHeight - viewport.height) * progress;
    await page.evaluate((y) => window.scrollTo(0, y), scrollTo);
    await page.waitForTimeout(300);
    
    const currentScroll = await page.evaluate(() => window.scrollY);
    console.log(`  Scroll position ${Math.round(progress * 100)}%: scrollY = ${currentScroll}`);
  }

  await captureScreenshot(page, 'mobile-scrolled-bottom', viewport);
  
  // Scroll back to top
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(300);
}

async function main() {
  console.log('═══════════════════════════════════════════════');
  console.log('  VerseSEO Visual Verification');
  console.log('  Connecting to: ' + DEV_URL);
  console.log('═══════════════════════════════════════════════');

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    reducedMotion: 'no-preference',
    timeout: 60000
  });
  const page = await context.newPage();
  page.setDefaultTimeout(60000);

  try {
    await verifyDesktop(page);
    await verifyMobile(page);
  } catch (error) {
    console.error('\n  ❌ Verification error:', error.message);
    results.failed.push({ name: 'Script error', actual: error.message });
  } finally {
    await browser.close();
  }

  // Summary
  console.log('\n═══════════════════════════════════════════════');
  console.log('  VERIFICATION SUMMARY');
  console.log('═══════════════════════════════════════════════');
  console.log(`  Passed: ${results.passed.length}`);
  console.log(`  Failed: ${results.failed.length}`);
  console.log(`  Screenshots: ${results.screenshots.length}`);
  
  if (results.failed.length > 0) {
    console.log('\n  FAILURES:');
    results.failed.forEach((f, i) => {
      console.log(`  ${i + 1}. ${f.name}`);
      if (f.expected) console.log(`     Expected: ${f.expected}`);
      if (f.actual) console.log(`     Actual: ${f.actual}`);
      if (f.boundingBox) console.log(`     Bounding box: ${JSON.stringify(f.boundingBox)}`);
      if (f.viewport) console.log(`     Viewport: ${f.viewport}`);
      if (f.scrollPosition !== undefined) console.log(`     Scroll: ${f.scrollPosition}`);
    });
  }

  console.log('\n  BOUNDING BOXES:');
  results.boundingBoxes.forEach(b => {
    console.log(`  ${b.selector}: ${JSON.stringify(b.bbox)} @ ${b.viewport.width}x${b.viewport.height}`);
  });

  console.log('\n  Screenshots saved to: ' + SCREENSHOT_DIR);
  
  // Write results to JSON
  const reportPath = join(SCREENSHOT_DIR, 'verification-report.json');
  writeFileSync(reportPath, JSON.stringify(results, null, 2));
  console.log(`  Report saved to: ${reportPath}`);

  process.exit(results.failed.length > 0 ? 1 : 0);
}

main();
