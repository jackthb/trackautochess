import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createServer, transformWithEsbuild } from 'vite';
import { chromium, expect } from '@playwright/test';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const fixture = '\0capture-fixture.jsx';
const server = await createServer({
  root, configFile: false, esbuild: { jsx: 'automatic' },
  resolve: { alias: { '@dac/shared': `${root}shared` } },
  server: { host: '127.0.0.1', port: 0 },
  plugins: [{
    name: 'capture-test',
    resolveId(id) { if (id === fixture) return fixture; },
    transform(code, id) { if (id === fixture) return transformWithEsbuild(code, 'fixture.jsx', { loader: 'jsx', jsx: 'automatic' }); },
    load(id) {
      if (id !== fixture) return;
      return `
        import React from 'react';
        import { createRoot } from 'react-dom/client';
        import { TrackerHome } from '/app/src/components/TrackerHome.tsx';
        import { useNetTableEvents } from '/app/src/hooks/useNetTableEvents.ts';
        const listeners = new Set();
        window.emit = event => listeners.forEach(fn => fn(event));
        window.commands = [];
        window.snapshot = { type:'nettable_status', autoexec_installed:true, has_condebug:true,
          has_conclearlog:true, has_gamestateintegration:true, dota_running:false,
          capture_phase:'interrupted', pending_leave_expires_at:'2030-01-01T12:30:00Z' };
        window.tracker = {
          onEvent(fn) { listeners.add(fn); return () => listeners.delete(fn); },
          sendCommand(cmd) {
            window.commands.push(cmd);
            if(cmd.cmd === 'nettable_status') queueMicrotask(() => window.emit(window.snapshot));
            if(cmd.cmd === 'outbox_status') queueMicrotask(() => window.emit({type:'outbox_status',request_id:cmd.request_id,pending:0}));
          }
        };
        window.appApi = {getVersion:async()=> 'test', fetchSynergies:async()=>({})};
        function App(){const state=useNetTableEvents();return <TrackerHome unitsFull={{}} netTable={state} status={{steam_id:'76561197960265729',steam_name:'Test'}}/>;}
        createRoot(document.getElementById('root')).render(<App/>);
      `;
    },
    configureServer(vite) {
      vite.middlewares.use('/__capture_test', (_req,res) => {
        res.setHeader('Content-Type','text/html');
        res.end('<div id="root"></div><script type="module" src="/@id/__x00__capture-fixture.jsx"></script>');
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
  ].find(p => p && existsSync(p));
  browser = await chromium.launch({executablePath});
  const page = await browser.newPage();
  const errors=[]; page.on('pageerror',e=>errors.push(e.message));
  await page.goto(`${server.resolvedUrls.local[0]}__capture_test`);
  const card=page.getByRole('status',{name:'Match capture status'});
  await expect(card).toContainText('Match interrupted');
  // Renderer reload recovers from status alone, without a pending event.
  await page.reload();
  await expect(card).toContainText('Match interrupted');
  await page.evaluate(() => {
    window.emit({type:'nettable_rows',rows:[{table_name:'test',key:'data',raw:{}}]});
    window.emit({type:'nettable_round_changed',round:12});
  });
  await expect(card).toContainText('Match interrupted');
  const save=page.getByRole('button',{name:'Save partial result'});
  await save.focus(); await page.keyboard.press('Enter');
  await expect(card.getByRole('button')).toBeDisabled();
  assert.equal(await page.evaluate(()=>window.commands.filter(c=>c.cmd==='nettable_confirm_match_end').length),1);
  for (const [phase,title] of [['retrying','Upload pending'],['saved_partial','Saved — incomplete'],['saved_complete','Saved — complete']]) {
    await page.evaluate(phase => {window.snapshot={...window.snapshot,capture_phase:phase,pending_leave_expires_at:null};window.emit(window.snapshot);},phase);
    await expect(card).toContainText(title);
    await expect(card.getByRole('button')).toHaveCount(0);
  }
  await page.evaluate(()=>{window.snapshot={...window.snapshot,capture_phase:null,in_match:true,current_round:13};window.emit(window.snapshot);});
  await expect(card).toHaveCount(0);
  assert.deepEqual(errors,[]);
  console.log('Tracker capture states, reload recovery, stale events and keyboard action passed.');
} finally {await browser?.close();await server.close();}
