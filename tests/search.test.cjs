const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const script=fs.readFileSync(path.join(root,'index.html'),'utf8').match(/<script>([\s\S]*?)<\/script>/)[1];
const reply=documents=>({ok:true,json:async()=>({found:documents.length,hits:documents.map(document=>({document}))})});
function app(fetch=async()=>reply([]),overrides={}){
 const elements=new Map();
 const document={querySelectorAll:()=>[],getElementById(id){if(!elements.has(id))elements.set(id,{textContent:'',innerHTML:'',style:{},classList:{add(){},remove(){}},addEventListener(){}});return elements.get(id)}};
 const context=vm.createContext({document,window:{scrollTo(){}},URL,URLSearchParams,Intl,AbortController,setTimeout,clearTimeout,console:{error(){}},fetch,...overrides});
 vm.runInContext(script,context);
 return {context,elements,run:code=>vm.runInContext(code,context),search:()=>elements.get('searchNow').onclick(),rank(query,products,mode='best'){context.input={query,products,mode};return vm.runInContext('state.q=input.query;state.poison=input.mode;products=input.products;find()',context)}};
}
const product=(title,price=1000)=>({title,price,merchant:'Test store',image:'https://example.com/image.png',link:'https://example.com/deal'});
for(const mode of ['best','cheapest'])test(mode+': keep the lower priced duplicate offer',()=>{
 const a=app();const results=a.rank('iPhone',[product('Telefon Apple iPhone 16',5000),product('Telefon Apple iPhone 16',3000)],mode);
 assert.equal(results.length,1);assert.equal(results[0].price,3000);
});
test('gaming laptop intent rejects backpacks and keeps INT Keyboard laptops',()=>{
 const a=app();const results=a.rank('gaming laptop',[product('Rucsac laptop gaming',500),product('Laptop Gaming ASUS TUF (INT Keyboard)',4000),product('Laptop business',2000),product('Gaming mouse',600)]);
 assert.equal(results.length,1);assert.match(results[0].title,/ASUS/);
});
test('explicit laptop accessory searches still work',()=>{assert.equal(app().rank('laptop charger',[product('Laptop charger',100)]).length,1)});
test('iPhone rejects PCB repair equipment',()=>{assert.equal(app().rank('iPhone',[product('Mijing Plita PCB iRepair pentru Apple iPhone X - 13 Series',700)]).length,0)});
test('Nintendo retains consoles and excludes games/controllers',()=>{
 const results=app().rank('Nintendo',[product('Consola Nintendo Switch OLED'),product('Joc Nintendo Switch',500),product('Controller Nintendo Switch',500)]);
 assert.equal(results.length,1);assert.match(results[0].title,/Consola/);
});
test('TV rejects non-television products but retains The Frame TVs',()=>{
 const results=app().rank('TV',[product('TV Samsung The Frame 55 inch',3000),...['Media Player Fire TV Stick','Comoda TV','Tastatura Apple TV','Antena TV','Banda LED TV Backlight','uport TV Blackmount'].map(t=>product(t,700))]);
 assert.equal(results.length,1);assert.match(results[0].title,/Frame/);
});
test('invalid prices cannot win cheapest',()=>{
 const results=app().rank('phone',[product('phone',0),product('phone',-1),product('phone','bad'),product('phone',100)],'cheapest');assert.equal(results.length,1);assert.equal(results[0].price,100);
});
test('adapter sends required query, disables dropped tokens, validates documents',async()=>{
 let request;const a=app(async(url,options)=>{request={url:new URL(url),options};return reply([product('iPhone 16','3000'),{price:1},product('bad',0)])});
 const result=await a.run('loadFromTypesense("iPhone",new AbortController().signal)');
 assert.equal(request.url.searchParams.get('q'),'iPhone');assert.equal(request.url.searchParams.get('query_by'),'title');assert.equal(request.url.searchParams.get('drop_tokens_threshold'),'0');assert(request.options.headers['X-TYPESENSE-API-KEY']);assert.equal(result.documents.length,1);assert.equal(result.documents[0].price,3000);
});
test('candidate pagination reaches later matches and stops at four pages',async()=>{
 const pages=[];const a=app(async url=>{const page=Number(new URL(url).searchParams.get('page'));pages.push(page);return {ok:true,json:async()=>({found:1200,hits:Array.from({length:250},(_,i)=>({document:product('Phone '+((page-1)*250+i))}))})}});
 const result=await a.run('loadFromTypesense("phone")');assert.deepEqual(pages,[1,2,3,4]);assert.equal(result.documents.length,1000);assert.equal(result.truncated,true);
});
test('authentication error produces readable empty result state',async()=>{
 const a=app(async()=>({ok:false,status:401}));await a.search();assert.match(a.elements.get('list').innerHTML,/Search unavailable/);assert.equal(a.elements.get('truth').textContent,'No results loaded.');assert.equal(a.run('products.length'),0);
});
test('malformed payload is rejected instead of pretending no results',async()=>{
 const a=app(async()=>({ok:true,json:async()=>({unexpected:true})}));await a.search();assert.match(a.elements.get('list').innerHTML,/Search unavailable/);
});
test('empty results safely render the user query',async()=>{
 const a=app();a.run('state.q=`<img src=x onerror="bad">`');await a.search();const output=a.elements.get('list').innerHTML;assert.match(output,/&lt;img/);assert(!output.includes('<img'));assert.match(output,/No real deals found/);
});
test('product rendering escapes text and rejects executable links',async()=>{
 const p=product('Phone <img onerror="bad">');p.link='javascript:alert(1)';p.image='data:text/html,test';const a=app(async()=>reply([p]));a.run('state.q="Phone"');await a.search();const output=a.elements.get('list').innerHTML;assert.match(output,/&lt;img/);assert(!output.includes('javascript:'));assert(!output.includes('<img'));
});
test('slow previous search cannot overwrite the latest result',async()=>{
 const pending=[];const a=app((url,options)=>new Promise(resolve=>pending.push({url,options,resolve})));
 a.run('state.q="iPhone"');const first=a.search();a.run('state.q="Nintendo"');const second=a.search();assert.equal(pending[0].options.signal.aborted,true);
 pending[1].resolve(reply([product('Consola Nintendo Switch')]));await second;pending[0].resolve(reply([product('Telefon iPhone 16')]));await first;assert.match(a.elements.get('list').innerHTML,/Nintendo/);assert(!a.elements.get('list').innerHTML.includes('iPhone'));
});
test('leaving results cancels pending search and ignores late response',async()=>{
 let finish;const a=app(()=>new Promise(resolve=>{finish=resolve}));const pending=a.search();a.run('show("home")');const before=a.elements.get('list').innerHTML;finish(reply([product('headphones')]));await pending;assert.equal(a.elements.get('list').innerHTML,before);
});
test('timeout aborts and shows a retry message',async()=>{
 let timeout;const a=app((url,{signal})=>new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(Object.assign(new Error('aborted'),{name:'AbortError'})))),{setTimeout:fn=>{timeout=fn;return 1},clearTimeout(){}});
 const pending=a.search();timeout();await pending;assert.match(a.elements.get('list').innerHTML,/took too long/);
});
test('fastest mode preserves the honest delivery-data notice',async()=>{
 const a=app(async()=>reply([product('headphones')]));a.run('state.poison="fastest"');await a.search();assert.match(a.elements.get('truth').textContent,/does not invent delivery rankings/);
});
const files=['products-1.json','products-2.json'];
const feed=files.flatMap(f=>JSON.parse(fs.readFileSync(path.join(root,f),'utf8')));
for(const [query,expected] of [['iPhone',/\bTelefon\b/i],['gaming laptop',/\blaptop\b.*\bgaming\b|\bgaming\b.*\blaptop\b/i],['Nintendo',/\bconsola\b/i],['TV',/\btelevizor\b/i]])test('local feed regression: '+query,()=>{
 const results=app().rank(query,feed);assert.equal(results.length,10);for(const p of results)assert.match(p.title,expected);
});

test('records without images use the remaining card width',async()=>{
 const p=product('Apple iPhone 16',3000);delete p.image;delete p.link;const a=app(async()=>reply([p]));a.run('state.q="iPhone"');await a.search();assert.match(a.elements.get('list').innerHTML,/grid-column:2 \/ -1/);assert(!a.elements.get('list').innerHTML.includes('View Deal'));
});
test('high-priced replacement iPhone parts are excluded',()=>{assert.equal(app().rank('iPhone',[product('iPhone 13 Replacement Charging Port',1000)]).length,0)});
