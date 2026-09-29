'use strict';
const {createHash}=require('node:crypto');
const sha256=value=>createHash('sha256').update(value).digest('hex');
const VERSION='dwyn-affiliate-v1';
const KNOWN_ENTITIES={nbsp:' ',amp:'&',quot:'"',apos:"'",lt:'<',gt:'>'};
function text(value,field,{required=false}={}){
 if(value==null||value===''){if(required)throw new Error(field+': required');return null;}
 if(typeof value!=='string')throw new Error(field+': expected a string');
 const clean=value.replace(/&(#x[\da-f]+|#\d+|nbsp|amp|quot|apos|lt|gt);/gi,(whole,key)=>{
  if(key[0]!=='#')return KNOWN_ENTITIES[key.toLowerCase()];
  const code=key[1].toLowerCase()==='x'?parseInt(key.slice(2),16):Number(key.slice(1));
  return code>0&&code<=0x10ffff&&!(code>=0xd800&&code<=0xdfff)?String.fromCodePoint(code):whole;
 }).normalize('NFC').replace(/\s+/gu,' ').trim();
 if(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(clean))throw new Error(field+': control character');
 if(!clean&&required)throw new Error(field+': required');
 return clean||null;
}
function httpURL(value,field,{required=false}={}){
 if(value==null||value===''){if(required)throw new Error(field+': required');return null;}
 if(typeof value!=='string'||value!==value.trim()||/[\s\u0000-\u001f]/u.test(value))throw new Error(field+': invalid URL text');
 let url;try{url=new URL(value)}catch{throw new Error(field+': invalid URL')}
 if(!['http:','https:'].includes(url.protocol)||url.username||url.password)throw new Error(field+': must be HTTP(S) without credentials');
 return value; // Preserve the exact original URL, including affiliate tracking.
}
function timestamp(value,field){
 if(value==null||value==='')return null;
 // Accept explicit UTC timestamps only: never guess whether an integer is YYYYMMDD or epoch seconds.
 if(typeof value!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(value))throw new Error(field+': expected ISO UTC timestamp, e.g. 2026-09-27T12:00:00Z');
 const ms=Date.parse(value);
 if(!Number.isFinite(ms)||new Date(ms).toISOString().replace('.000Z','Z')!==value.replace('.000Z','Z'))throw new Error(field+': invalid date');
 return Math.floor(ms/1000);
}
function code(value,field,pattern){const v=text(value,field);if(!v)return null;const upper=v.toUpperCase();if(!pattern.test(upper))throw new Error(field+': invalid code');return upper;}
function enumeration(value,field,allowed){const v=text(value,field)||'unknown';if(!allowed.includes(v))throw new Error(field+': unsupported value '+v);return v;}
function sourceIdentity(link){
 const u=new URL(link);
 if(u.hostname!=='event.2performant.com'||u.pathname!=='/events/click'||u.hash||u.port)throw new Error('link: unsupported affiliate source');
 for(const key of ['campaign_unique','unique','ad_type'])if(u.searchParams.getAll(key).length!==1)throw new Error('link: missing or repeated '+key);
 if(u.searchParams.get('ad_type')!=='product_store')throw new Error('link: expected product_store');
 const campaign=u.searchParams.get('campaign_unique'),item=u.searchParams.get('unique');
 if(!/^[A-Za-z0-9_-]+$/.test(campaign)||!/^[A-Za-z0-9_-]+$/.test(item))throw new Error('link: invalid source identity token');
 const tuple=[VERSION,'dwyn.ro','2performant',campaign,item];
 return {id:'dwyn_'+sha256(JSON.stringify(tuple)),campaign,item,tuple};
}
const TIME_FIELDS=['source_exported_at','source_updated_at','product_released_at','first_seen_at','last_seen_at','imported_at'];
const OPTIONAL_TEXT=['brand','category','merchant_category','merchant_product_id'];
function normalizeRecord(raw){
 if(!raw||Array.isArray(raw)||typeof raw!=='object')throw new Error('record: expected object');
 const merchant=text(raw.merchant,'merchant',{required:true});if(merchant!=='dwyn.ro')throw new Error('merchant: this adapter accepts dwyn.ro only');
 const title=text(raw.title,'title',{required:true});
 if(typeof raw.price!=='number'||!Number.isFinite(raw.price)||raw.price<=0)throw new Error('price: expected a positive finite number; no string/currency guessing');
 const link=httpURL(raw.link,'link',{required:true}),identity=sourceIdentity(link);
 const record={id:identity.id,title,merchant,merchant_id:'dwyn.ro',price:raw.price,link,image:httpURL(raw.image,'image'),description:text(raw.description,'description')};
 for(const field of OPTIONAL_TEXT)record[field]=text(raw[field],field);
 record.country=code(raw.country,'country',/^[A-Z]{2}$/);
 record.regions=null;if(raw.regions!=null){if(!Array.isArray(raw.regions)||raw.regions.some(x=>typeof x!=='string'||!x.trim()))throw new Error('regions: expected nonempty string values');record.regions=[...new Set(raw.regions.map(x=>text(x,'regions')))];if(!record.regions.length)record.regions=null;}
 record.currency=code(raw.currency,'currency',/^[A-Z]{3}$/);
 if(record.currency&&!Intl.supportedValuesOf('currency').includes(record.currency))throw new Error('currency: expected a supported ISO currency code; no inference from labels such as lei');
 record.currency_status=record.currency?'source_supplied':'unresolved';
 record.product_url=httpURL(raw.product_url,'product_url');
 record.availability=enumeration(raw.availability,'availability',['unknown','in_stock','out_of_stock','preorder','backorder']);
 record.condition=enumeration(raw.condition,'condition',['unknown','new','used','refurbished']);
 for(const field of TIME_FIELDS)record[field]=timestamp(raw[field],field);
 record.newness=null; // Undefined legacy meaning: do not reinterpret source dates or model years.
 record.source_network='2performant';record.source_campaign_id=identity.campaign;record.source_item_id=identity.item;record.identity_version=VERSION;
 const warnings=[];
 if(title!==raw.title)warnings.push('TITLE_NORMALIZED');
 for(const key of ['brand','category','currency','country','product_url','source_updated_at','source_exported_at'])if(record[key]===null)warnings.push('MISSING_'+key.toUpperCase());
 if(!record.image)warnings.push('MISSING_IMAGE');if(!record.description)warnings.push('EMPTY_DESCRIPTION');
 if(record.availability==='unknown')warnings.push('AVAILABILITY_UNKNOWN');if(record.condition==='unknown')warnings.push('CONDITION_UNKNOWN');
 if(raw.newness!=null)warnings.push('LEGACY_NEWNESS_NOT_MAPPED');
 warnings.push('SOURCE_ID_PERSISTENCE_UNVERIFIED','URL_REACHABILITY_NOT_CHECKED');
 const publicationBlockers=['FEED_FRESHNESS_NOT_VERIFIED'];
 if(!record.currency)publicationBlockers.push('CURRENCY_UNRESOLVED');else if(record.currency!=='RON')publicationBlockers.push('FRONTEND_SUPPORTS_RON_ONLY');
 if(record.condition!=='new')publicationBlockers.push('FRONTEND_LABELS_ALL_RESULTS_NEW');
 return {record,warnings,publicationBlockers,identity:identity.tuple};
}
function toTypesense(record){return Object.fromEntries(Object.entries(record).filter(([,v])=>v!==null&&v!==undefined));}
function convertSample(envelope){
 if(!envelope||!Array.isArray(envelope.products)||envelope.products.length!==100)throw new Error('Expected the validated 100-product envelope. Full catalogs and other sizes are refused.');
 const seen=new Set(),audit=[],records=[],errors=[];
 for(const [i,item]of envelope.products.entries()){
  try{
   if(!item.source||typeof item.source.file!=='string'||!Number.isSafeInteger(item.source.array_index_zero_based)||item.source.array_index_zero_based<0)throw new Error('source: missing file/array index trace');
   const result=normalizeRecord(item.original);
   if(seen.has(result.record.id))throw new Error('duplicate source identity: '+result.record.id);
   seen.add(result.record.id);records.push(result.record);
   audit.push({sample_number:i+1,source:item.source,original:item.original,...result});
  }catch(error){errors.push({sample_number:i+1,source:item?.source,message:error.message});}
 }
 return {records,audit,errors};
}
function typesenseSchema(){
 const fields=[{name:'title',type:'string'},{name:'price',type:'float'},{name:'merchant',type:'string',facet:true}];
 for(const name of ['merchant_id','brand','category','merchant_category','country','currency','availability','condition','currency_status','source_network'])fields.push({name,type:'string',optional:true,facet:true});
 fields.push({name:'regions',type:'string[]',optional:true,facet:true});
 for(const name of ['link','image','product_url','description','merchant_product_id','source_campaign_id','source_item_id','identity_version'])fields.push({name,type:'string',optional:true,index:false});
 for(const name of TIME_FIELDS)fields.push({name,type:'int64',optional:true});
 return {name:'ugly_products',fields}; // id is Typesense's built-in string identity; newness remains undefined.
}
function compareSchema(existing,documents){
 if(!existing)return {status:'not_inspected',notes:['Live schema not fetched. This is a proposed target, not an applied migration.','Existing required brand/category/country/newness must become optional if absent in these records.','Do not replace the existing schema or its default_sorting_field automatically.']};
 if(existing.name!=='ugly_products'||!Array.isArray(existing.fields))throw new Error('schema: expected ugly_products collection schema');
 const names=new Map(existing.fields.map(f=>[f.name,f]));const proposed=typesenseSchema();
 const missingRequired=existing.fields.filter(f=>f.name!=='.*'&&!f.optional&&documents.some(doc=>!(f.name in doc))).map(f=>f.name);
 const differences=proposed.fields.flatMap(f=>{const old=names.get(f.name);if(!old)return [{field:f.name,kind:'proposed_addition',definition:f}];const changes={};for(const k of ['type','optional','facet','index']){const defaults={optional:false,facet:false,index:true};if((old[k]??defaults[k])!==(f[k]??defaults[k]))changes[k]={current:old[k]??defaults[k],proposed:f[k]??defaults[k]};}return Object.keys(changes).length?[{field:f.name,kind:'review_definition',changes}]:[];});
 return {status:'offline_comparison_only',missing_required_in_documents:missingRequired,differences,default_sorting_field:existing.default_sorting_field??null,notes:['No alteration performed. Additions include storage-only fields which can also be stored outside an explicit schema.','Optional/facet changes and type changes need review against existing documents before any ALTER.','A required legacy newness field needs an explicit decision; no synthetic newness is generated.']};
}
module.exports={sha256,text,timestamp,sourceIdentity,normalizeRecord,toTypesense,convertSample,typesenseSchema,compareSchema};
