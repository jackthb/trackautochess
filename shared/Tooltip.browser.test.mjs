// Run from the repository root: node shared/Tooltip.browser.test.mjs
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createServer, transformWithEsbuild } from "vite";
import { chromium } from "@playwright/test";

const root = fileURLToPath(new URL("../", import.meta.url));
const fixtureId = "\0tooltip-fixture.jsx";
const server = await createServer({
  root,
  configFile: false,
  esbuild: { jsx: "automatic" },
  server: { host: "127.0.0.1", port: 0 },
  plugins: [{
    name: "tooltip-test-fixture",
    resolveId(id) { if (id === fixtureId || id === "tooltip-fixture.jsx") return fixtureId; },
    transform(code, id) {
      if (id === fixtureId) return transformWithEsbuild(code, 'tooltip-fixture.jsx', { loader: 'jsx', jsx: 'automatic' });
    },
    load(id) {
      if (id !== fixtureId) return;
      return `
        import React from 'react';
        import { createRoot } from 'react-dom/client';
        import { TooltipWrap } from '/shared/Tooltip.tsx';
        import { ChessBoard } from '/shared/ChessBoard.tsx';
        import { GameRowDisplay } from '/shared/GameRowDisplay.tsx';
        const data = { iconUrl: () => 'data:,', relicsData: { Test: { name: 'Test', description: 'Relic details' } } };
        function App() {
          const [mounted, setMounted] = React.useState(true);
          const [clicks, setClicks] = React.useState(0);
          return <><button id="before">Before</button>
            <div style={{ height: 80 }}>{mounted && <TooltipWrap type="relic" name="Test" data={data}><span id="plain">Icon</span></TooltipWrap>}</div>
            <TooltipWrap type="relic" name="Test" data={data}><button id="nested" aria-describedby="existing">Nested</button></TooltipWrap>
            <span id="existing">Original description</span>
            <button id="remove" onClick={() => setMounted(false)}>Remove</button>
            <output id="clicks">{clicks}</output>
            <div id="clickable-row"><GameRowDisplay game={{ placement: '1' }} unitCosts={{}} iconUrl={() => 'data:,'} onClick={() => setClicks(n => n + 1)} dateExtra={<button id="row-action">Action</button>} /></div>
            <div id="passive-row"><GameRowDisplay game={{ placement: '2' }} unitCosts={{}} iconUrl={() => 'data:,'} /></div>
            <div id="board"><ChessBoard board={[{name:'Test', x:1, y:1, items:['Sword']}]} unitCosts={{}} iconUrl={() => 'data:,'} /></div>
            <div id="board-with-unit"><ChessBoard board={[{name:'Test', x:1, y:1, items:['Sword']}]} unitCosts={{}} iconUrl={() => 'data:,'} tooltipData={{...data, unitsFull: {Test: {name:'Test', synergies: []}}}} /></div>
          </>;
        }
        createRoot(document.getElementById('root')).render(<App />);
      `;
    },
    configureServer(vite) {
      vite.middlewares.use('/__tooltip_test', (_req, res) => {
        res.setHeader('Content-Type', 'text/html');
        res.end('<link rel="icon" href="data:,"><div id="root"></div><script type="module" src="/@id/__x00__tooltip-fixture.jsx"></script>');
      });
    },
  }],
});
let browser;
try {
  await server.listen();
  const executablePath = [process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  ].find(candidate => candidate && existsSync(candidate));
  browser = await chromium.launch({ executablePath });
  const page = await browser.newPage();
  const errors = [];
  page.on('console', message => { if (message.type() === 'error') console.error(message.text()); });
  page.on('response', response => { if (response.status() >= 400) console.error(response.status(), response.url()); });
  page.on('pageerror', error => { errors.push(error.message); console.error(error.message); });
  await page.goto(`${server.resolvedUrls.local[0]}__tooltip_test`);
  await page.locator('#before').focus();
  await page.keyboard.press('Tab');
  await page.getByRole('tooltip').waitFor();
  assert.equal(await page.locator('#plain').evaluate(el => el.parentElement === document.activeElement), true);
  assert.equal(await page.locator('#plain').evaluate(el => el.parentElement.getAttribute('aria-describedby')), await page.getByRole('tooltip').getAttribute('id'));
  await page.keyboard.press('Escape');
  await page.getByRole('tooltip').waitFor({ state: 'detached' });
  await page.keyboard.press('Tab');
  assert.equal(await page.locator('#nested').evaluate(el => el === document.activeElement), true);
  await page.getByRole('tooltip').waitFor();
  assert.match(await page.locator('#nested').getAttribute('aria-describedby'), /^existing\s/);
  await page.keyboard.press('Escape');
  await page.getByRole('tooltip').waitFor({ state: 'detached' });
  assert.equal(await page.locator('#nested').getAttribute('aria-describedby'), 'existing');
  await page.locator('#before').focus();
  await page.locator('#plain').hover();
  await page.getByRole('tooltip').waitFor();
  await page.locator('#before').hover();
  await page.getByRole('tooltip').waitFor({ state: 'detached' });
  // Unmount while the delayed hover is pending: it must never leave a portal.
  await page.locator('#plain').hover();
  await page.locator('#remove').evaluate(el => el.click());
  await page.waitForTimeout(300);
  assert.equal(await page.getByRole('tooltip').count(), 0);
  const row = page.locator('#clickable-row .game-row');
  await row.focus();
  await page.keyboard.press('Enter');
  await page.keyboard.press('Space');
  assert.equal(await page.locator('#clicks').textContent(), '2');
  await page.locator('#row-action').focus();
  await page.keyboard.press('Enter');
  assert.equal(await page.locator('#clicks').textContent(), '2');
  assert.equal(await page.locator('#passive-row .game-row').getAttribute('tabindex'), null);
  await page.locator('#board .chess-board-piece').focus();
  await page.locator('.chess-board-item-tooltip').waitFor();
  assert.equal(await page.locator('#board .chess-board-piece').getAttribute('aria-describedby'), await page.locator('.chess-board-item-tooltip').getAttribute('id'));
  await page.keyboard.press('Escape');
  await page.locator('.chess-board-item-tooltip').waitFor({state:'detached'});
  await page.locator('#board-with-unit .chess-board-piece-tooltip-target').focus();
  await page.locator('.chess-board-item-tooltip').waitFor();
  assert.equal(await page.locator('#board-with-unit [tabindex="0"]').count(), 1);
  const descriptions = await page.locator('#board-with-unit .chess-board-piece-tooltip-target').getAttribute('aria-describedby');
  assert.equal(descriptions.split(/\s+/).length, 2);
  await page.keyboard.press('Escape');
  await page.getByRole('tooltip').waitFor({state:'detached'});
  assert.deepEqual(errors, []);
  console.log('Tooltip, game-row and chess-board keyboard checks passed.');
} finally {
  await browser?.close();
  await server.close();
}
