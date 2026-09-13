// Screenshot the running dev server with the installed Chrome, printing console output.
// node scripts/shot.mjs "http://127.0.0.1:5179/?src=/samples/ad-quiet.png" out.png [waitMs]
import puppeteer from 'puppeteer-core';

const [url, out = 'shot.png', waitMs = '4000'] = process.argv.slice(2);
const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--window-size=1440,900'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
page.on('console', (m) => console.log(`[console.${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => console.log(`[pageerror] ${e.message}`));
page.on('requestfailed', (r) => console.log(`[requestfailed] ${r.url()} ${r.failure()?.errorText}`));
await page.goto(url, { waitUntil: 'networkidle0', timeout: 120_000 });
try {
  await page.waitForFunction(() => document.getElementById('eyeLoading')?.hidden === true, { timeout: 90_000 });
  console.log('[shot] eye settled');
} catch {
  console.log('[shot] eye did not settle in time');
}
await new Promise((r) => setTimeout(r, Number(waitMs)));
const stats = await page.evaluate(() => ({
  state: document.getElementById('stateTag')?.textContent,
  glance: document.getElementById('glanceValue')?.textContent,
  spikes: document.getElementById('spikesValue')?.textContent,
  time: document.getElementById('timeValue')?.textContent,
  sim: document.getElementById('simSpeed')?.textContent,
  fps: document.getElementById('fps')?.textContent,
}));
console.log('[shot]', JSON.stringify(stats));
await page.screenshot({ path: out });
console.log(`[shot] wrote ${out}`);
await browser.close();
