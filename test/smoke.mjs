// Smoke test: serve ./site, search an address, check both lender lists, map and drawer, save screenshots. Usage: node smoke.mjs "address"
// Prereq: cd test && npm i playwright && npx playwright install chromium ; site/data must exist (run the pipeline first).
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const server = spawn('python3', ['-m', 'http.server', '8765'], { cwd: path.join(here, '..', 'site'), stdio: 'ignore' });
await new Promise(r => setTimeout(r, 1200));
const proxy = process.env.HTTPS_PROXY;
const args = ['--enable-unsafe-swiftshader']; if (proxy) args.push('--ignore-certificate-errors', '--proxy-server=' + proxy, '--proxy-bypass-list=127.0.0.1;localhost');
const browser = await chromium.launch({ args });
try {
  const page = await (await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1400, height: 900 } })).newPage();
  const errs = []; page.on('pageerror', e => errs.push('pageerror: ' + e.message)); page.on('console', m => { if (m.type() === 'error') errs.push(m.text().slice(0, 200)); });
  const q = process.argv[2] || '233 S Wacker Dr, Chicago, IL';
  await page.goto('http://127.0.0.1:8765/index.html?q=' + encodeURIComponent(q), { waitUntil: 'networkidle', timeout: 120000 });
  await page.waitForFunction(() => /lenders|not found|Failed|ZIP/.test(document.querySelector('#summary').textContent + document.querySelector('#addr-result').textContent), null, { timeout: 90000 }).catch(() => {});
  await page.waitForTimeout(3000);
  console.log('SUMMARY:', await page.textContent('#summary')); console.log('ADDR:', await page.textContent('#addr-result'));
  for (const id of ['hq', 'br']) {
    console.log((await page.textContent('#lt-' + id)) + ': ' + (await page.textContent('#ls-' + id)));
    const rows = await page.$$eval(`#cards-${id} .lcard`, cs => cs.slice(0, 5).map(c => c.querySelector('.lc-name').textContent + ' | ' + Array.from(c.querySelectorAll('.lc-stats > div')).map(d => d.textContent.trim()).join(' | ')));
    console.log(rows.join('\n'));
  }
  await page.screenshot({ path: path.join(here, 'shot-results.png') });
  const first = await page.$('.lcard'); if (first) { await first.click(); await page.waitForTimeout(2500); console.log('DRAWER:', (await page.textContent('#drawer-content')).slice(0, 200).replace(/\s+/g, ' ')); await page.screenshot({ path: path.join(here, 'shot-drawer.png') }); }
  console.log('ERRORS:', errs.filter(e => !e.includes('ERR_ABORTED')).join('\n') || 'none');
} finally { await browser.close(); server.kill(); }
