// Local-only preview. No dependencies; does not write to Typesense.
const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const fixtures=process.argv.includes('--fixtures');
const port=fixtures?4174:4173;
let feed;
if(fixtures)feed=['products-1.json','products-2.json'].flatMap(file=>JSON.parse(fs.readFileSync(path.join(__dirname,file),'utf8')));
const norm=value=>String(value??'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
http.createServer((req,res)=>{
 const url=new URL(req.url,'http://127.0.0.1');
 res.setHeader('Cache-Control','no-store');
 if(fixtures&&url.pathname==='/__fixture_search'){
  const terms=norm(url.searchParams.get('q')).split(/\s+/).filter(Boolean);
  // This is a test response, not an implementation of Typesense relevance.
  const matches=feed.filter(p=>terms.every(term=>norm(p.title).includes(term)));
  const page=Math.max(1,Number(url.searchParams.get('page'))||1);
  const size=Math.min(250,Math.max(1,Number(url.searchParams.get('per_page'))||250));
  res.setHeader('Content-Type','application/json');
  return res.end(JSON.stringify({found:matches.length,hits:matches.slice((page-1)*size,page*size).map(document=>({document}))}));
 }
 if(url.pathname!=='/'&&url.pathname!=='/index.html'){res.writeHead(404);return res.end('Not found');}
 let html=fs.readFileSync(path.join(__dirname,'index.html'),'utf8');
 if(fixtures){
  html=html.replace(/const url=`https:\/\/\$\{TYPESENSE_HOST\}[^`]+`;/,'const url=`/__fixture_search?${params}`;');
  html=html.replace('<body>','<body><div style="position:sticky;top:0;z-index:100;background:#633900;color:#fff;padding:8px;text-align:center">LOCAL CATALOG TEST — fixture responses, not live Typesense</div>');
  html=html.replace('UGLY search is now powered by Typesense.','Local catalog test response; not live Typesense.');
 }
 res.setHeader('Content-Type','text/html; charset=utf-8');res.end(html);
}).listen(port,'127.0.0.1',()=>console.log(`UGLY ${fixtures?'LOCAL FIXTURE TEST':'live search preview'}: http://127.0.0.1:${port}`));
