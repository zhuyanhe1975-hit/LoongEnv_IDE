const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  await page.goto('http://localhost:3000', { waitUntil: 'load', timeout: 30000 });
  const buttons = await page.locator('button').evaluateAll((els) => els.map((el, index) => ({ index, text: el.textContent })));
  console.log(JSON.stringify(buttons, null, 2));
  await browser.close();
})();
