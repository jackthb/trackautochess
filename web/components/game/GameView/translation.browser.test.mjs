import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createServer, transformWithEsbuild } from 'vite';
import { chromium } from '@playwright/test';

// Exercise the real match renderer with synthetic data, never live analytics.
const root = fileURLToPath(new URL('../../../', import.meta.url));
const server = await createServer({
  root, configFile: false, esbuild: { jsx: 'automatic' },
  define: { 'process.env': '{}' },
  resolve: { alias: { '@/lib/analytics': '\0analytics', '@': root, '@dac/shared': fileURLToPath(new URL('../../../../shared', import.meta.url)) } },
  server: { host: '127.0.0.1', port: 0 },
  plugins: [{
    name: 'match-translation-fixture', enforce: 'pre',
    resolveId(id) { if (id === 'match-fixture.jsx') return '\0match-fixture.jsx'; if (id === '@/lib/analytics' || id === '\0analytics') return '\0analytics'; },
    load(id) {
      if (id === '\0analytics') return 'export const trackEvent=()=>{}; export const analyticsRoute=x=>x; export const bucketCount=String;';
      if (id !== '\0match-fixture.jsx') return;
      return `import React from 'react'; import {createRoot} from 'react-dom/client';
        import GameView from '/components/game/GameView/index.tsx';
        const game={id:1,user_id:'test-player',placement:'1',lineup:'Axe★★',level:'3',wins:2,losses:1};
        const timeline={match_id:'test',first_round:1,last_round:2,round_count:2,rounds:[
          {round:1,players:{'test-player':{lineup:'Axe★',level:2,hp:100,total_money:1}}},
          {round:2,players:{'test-player':{lineup:'Axe★★',level:3,hp:90,total_money:2}}}]};
        createRoot(document.getElementById('root')).render(<GameView game={game} steamProfile={{name:'Test player'}} matchGames={[game]} matchProfiles={{}} relicTimelines={{}} timeline={timeline} route='/matches/[id]' />);`;
    },
    transform(code,id) { if(id==='\0match-fixture.jsx') return transformWithEsbuild(code,'match-fixture.jsx',{loader:'jsx',jsx:'automatic'}); },
    configureServer(vite) { vite.middlewares.use('/__match_test',(_req,res)=> { res.setHeader('Content-Type','text/html'); res.end('<div id="root"></div><script type="module" src="/@id/__x00__match-fixture.jsx"></script>'); }); },
  }],
});
let browser;
try {
  await server.listen();
  browser=await chromium.launch({executablePath:[process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,'C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p=>p&&existsSync(p))});
  for (const translated of [false,true]) {
    const page=await browser.newPage(); const errors=[];
    page.on('pageerror',error=>{errors.push(error.message); console.error(error.message);});
    await page.goto(`${server.resolvedUrls.local[0]}__match_test`);
    await page.getByRole('option',{name:'R2',exact:true}).waitFor();
    if (translated) {
      // Model a translator replacing React-owned text nodes with font elements.
      // Honor the standard translate boundary, like a conforming translator.
      const changed=await page.evaluate(()=>{
        const walker=document.createTreeWalker(document.getElementById('root'),NodeFilter.SHOW_TEXT);
        const nodes=[]; while(walker.nextNode()) nodes.push(walker.currentNode);
        let count=0;
        for(const node of nodes) {
          if(!node.textContent.trim()||node.parentElement.closest('[translate="no"]')) continue;
          const replacement=document.createElement('font'); replacement.textContent=node.textContent;
          node.parentNode.replaceChild(replacement,node); count++;
        }
        return count;
      });
      assert.ok(changed>0,'Translation simulation must actually mutate text');
    }
    await page.getByRole('option',{name:'R1',exact:true}).click();
    await page.waitForTimeout(100);
    assert.deepEqual(errors,[],`${translated?'Translated':'Normal'} round selection crashed`);
    assert.equal(await page.getByRole('option',{name:'R1',exact:true}).getAttribute('aria-selected'),'true');
    await page.getByRole('button',{name:'Collapse player details'}).click();
    await page.getByRole('button',{name:'Expand player details'}).click();
    await page.getByRole('button',{name:'End',exact:true}).click();
    assert.equal(await page.getByRole('option',{name:'R2',exact:true}).getAttribute('aria-selected'),'true');
    assert.deepEqual(errors,[],'Round and player interactions must remain usable');
    await page.close();
  }
  console.log('Normal and translation-simulation match interactions passed.');
} finally { await browser?.close(); await server.close(); }
