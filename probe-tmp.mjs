import { chromium } from '@playwright/test';
const b = await chromium.launch({ args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'] });
for (let i=0;i<4;i++){
  const p = await b.newPage({ viewport:{width:1280,height:800} });
  await p.goto('http://localhost:4173/voyager.html', { waitUntil:'load' });
  const before = await p.evaluate(()=>{const n=document.getElementById('cssmenu');return n?Math.round(n.getBoundingClientRect().height):null;});
  await p.evaluate(()=>document.fonts.ready);
  await p.waitForTimeout(500);
  const after = await p.evaluate(()=>{const n=document.getElementById('cssmenu');return n?Math.round(n.getBoundingClientRect().height):null;});
  const fonts = await p.evaluate(()=>document.fonts.status);
  console.log(`run ${i+1}: nav@load=${before}  nav@fontsReady=${after}  fontStatus=${fonts}`);
  await p.close();
}
await b.close();
