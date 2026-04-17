import { chromium } from 'playwright';

const url = process.argv[2] || 'http://localhost:8000';
const out = process.argv[3] || '/tmp/arena-screenshot.png';

const browser = await chromium.launch({ args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto(url, { waitUntil: 'networkidle' });
await page.waitForTimeout(3000);
await page.screenshot({ path: out, fullPage: false });
await browser.close();
console.log(`Screenshot saved to ${out}`);