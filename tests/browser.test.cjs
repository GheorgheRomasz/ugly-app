const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const http=require('node:http');
const {chromium}=require('playwright');
let browser,server,url;
before(async()=>{
 const html=fs.readFileSync(path.join(__dirname,'../index.html'));
 server=http.createServer((req,res)=>{res.setHeader('Content-Type','text/html; charset=utf-8');res.end(html)});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 url=`http://127.0.0.1:${server.address().port}`;
 browser=await chromium.launch({headless:true,...(process.env.UGLI_BROWSER_CHANNEL?{channel:process.env.UGLI_BROWSER_CHANNEL}:{})});
});
after(async()=>{await browser?.close();await new Promise(resolve=>server?server.close(resolve):resolve())});
async function open(viewport){
 const page=await browser.newPage({viewport});
 page.setDefaultTimeout(5000);
 // Deterministic UI tests: never contact production Typesense or merchant sites.
 await page.route('**/*',route=>{
  const requestUrl=new URL(route.request().url());
  if(requestUrl.hostname==='127.0.0.1')return route.continue();
  if(requestUrl.pathname.endsWith('/documents/search'))return route.fulfill({json:requestUrl.searchParams.get('q').includes('VeryLongQuery')?{found:0,hits:[]}:{found:1,hits:[{document:{title:'Apple iPhone 16',price:3000,merchant:'Test store'}}]}});
  return route.abort();
 });
 await page.goto(url);
 return page;
}
async function start(page,query='iPhone'){
 await page.locator('#heroInput').fill(query);
 await page.locator('#heroInput').press('Enter');
 await page.locator('#choose').waitFor({state:'visible'});
}
async function screenshot(page,name){
 if(!process.env.UGLI_SCREENSHOT_DIR)return;
 fs.mkdirSync(process.env.UGLI_SCREENSHOT_DIR,{recursive:true});
 await page.screenshot({path:path.join(process.env.UGLI_SCREENSHOT_DIR,name+'.png'),fullPage:true});
}
for(const viewport of [{width:320,height:740},{width:390,height:844},{width:1440,height:900}]){
 const size=viewport.width;
 test(`${size}px: back preserves the previous query and preference; X resets and focuses input`,async()=>{
  const page=await open(viewport);
  try{
   await start(page);
   await page.locator('[data-p="cheapest"]').click();
   await page.locator('#searchNow').click();
   await page.locator('.product .rank').waitFor();
   await screenshot(page,`results-${size}`);
   await page.locator('#results .query-back').click();
   assert.equal(await page.locator('#choose .qtxt').textContent(),'iPhone');
   assert.equal(await page.evaluate(()=>state.poison),'cheapest');
   await page.locator('#wizardBack').click();
   assert.equal(await page.locator('#heroInput').inputValue(),'iPhone');
   assert(await page.locator('#heroInput').evaluate(el=>el===document.activeElement));
   await start(page);
   await page.locator('#wizardClear').click();
   assert.equal(await page.locator('#heroInput').inputValue(),'');
   assert(await page.locator('#heroInput').evaluate(el=>el===document.activeElement));
   assert.equal(await page.evaluate(()=>state.poison),'best');
   assert.equal(await page.locator('#list').textContent(),'');
   await start(page);
   await page.locator('#searchNow').click();
   await page.locator('.product .rank').waitFor();
   await page.locator('#results .query-clear').click();
   assert.equal(await page.locator('#heroInput').inputValue(),'');
   assert(await page.locator('#heroInput').evaluate(el=>el===document.activeElement));
  }finally{await page.close()}
 });
 test(`${size}px: long queries stay contained and editable on every screen`,async()=>{
  const page=await open(viewport);
  try{
   const query='iPhone '+'VeryLongQuery'.repeat(24);
   await page.locator('#heroInput').fill(query);
   assert(await page.locator('#heroInput').evaluate(el=>!el.matches(':placeholder-shown')&&getComputedStyle(el).backgroundColor!=='rgba(0, 0, 0, 0)'));
   await screenshot(page,`home-typed-${size}`);
   await page.locator('#heroInput').press('Enter');
   for(const screen of ['choose','results']){
    if(screen==='results'){await page.locator('#searchNow').click();await page.locator('#list').getByText('No real deals found').waitFor()}
    assert.equal(await page.locator(`#${screen} .qtxt`).textContent(),query);
    const bounds=await page.locator(`#${screen} .querybox`).evaluate(el=>({width:el.clientWidth,scroll:el.scrollWidth,right:el.getBoundingClientRect().right}));
    assert(bounds.scroll<=bounds.width+1);assert(bounds.right<=size);
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    for(const control of ['.query-back','.query-clear'])assert(await page.locator(`#${screen} ${control}`).isVisible());
    await screenshot(page,`${screen}-long-${size}`);
   }
   await page.locator('#results .query-back').click();await page.locator('#wizardBack').click();
   assert.equal(await page.locator('#heroInput').inputValue(),query);
  }finally{await page.close()}
 });
 test(`${size}px: Photo Search and USED stay unavailable; home artwork stays cropped`,async()=>{
  const page=await open(viewport);
  try{
   const homePhoto=page.locator('#home .photo-search');
   assert(await homePhoto.isVisible());assert(await homePhoto.isDisabled());
   assert.match(await homePhoto.textContent(),/Photo Search \/ Find This.*Coming Soon/);
   await screenshot(page,`home-${size}`);
   const crop=await page.locator('.home-art-window').evaluate(el=>({overflow:getComputedStyle(el).overflow,ratio:el.clientHeight/el.clientWidth,childHeight:el.firstElementChild.clientHeight}));
   assert.equal(crop.overflow,'hidden');assert(Math.abs(crop.ratio-1545/941)<0.01);
   await start(page);
   assert(await page.locator('#choose .photo-search').isDisabled());
   assert.match(await page.locator('#usedBtn').textContent(),/Coming soon/);
   assert(await page.locator('#usedBtn').isDisabled());
   assert.equal(await page.evaluate(()=>state.condition),'new');
   await screenshot(page,`choose-${size}`);
  }finally{await page.close()}
 });
}
