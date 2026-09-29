#!/usr/bin/env node
'use strict';
// Offline only: no network libraries, no Typesense key, no upload or schema mutation command.
const fs=require('node:fs');const path=require('node:path');
const {sha256,convertSample,toTypesense,typesenseSchema,compareSchema}=require('./normalize.cjs');
function parse(argv){const args={};for(let i=0;i<argv.length;i+=2){if(!['--input','--out','--schema'].includes(argv[i])||!argv[i+1]||argv[i+1].startsWith('--')||args[argv[i]])throw new Error('Usage: node catalog-import/import.cjs --input <validated-sample.json> --out <NEW-output-folder> [--schema <saved-schema.json>]');args[argv[i]]=argv[i+1];}if(!args['--input']||!args['--out'])throw new Error('--input and --out are required');return args;}
function main(){
 const args=parse(process.argv.slice(2));const input=path.resolve(args['--input']),out=path.resolve(args['--out']);
 // Do not overwrite an earlier run or leave stale JSONL masquerading as a successful new run.
 if(fs.existsSync(out))throw new Error('Output folder already exists; choose a new folder.');
 const inputBytes=fs.readFileSync(input);const envelope=JSON.parse(inputBytes.toString('utf8'));
 const result=convertSample(envelope),documents=result.records.map(toTypesense);
 const existing=args['--schema']?JSON.parse(fs.readFileSync(path.resolve(args['--schema']),'utf8')):null;
 const schemaReview=compareSchema(existing,documents);
 fs.mkdirSync(out,{recursive:true});
 const write=(name,value)=>fs.writeFileSync(path.join(out,name),JSON.stringify(value,null,2)+'\n');
 const counts={};for(const row of result.audit)for(const code of row.warnings)counts[code]=(counts[code]||0)+1;
 const report={mode:'offline_review_only',prepared_at:new Date().toISOString(),input_file:input,input_sha256:sha256(inputBytes),input_count:100,valid_count:result.records.length,error_count:result.errors.length,errors:result.errors,warning_counts:counts,currency_unresolved:result.records.filter(r=>!r.currency).length,publication_ready:false,upload_performed:false,schema_changed:false,jsonl_generated:!result.errors.length,schema_review:schemaReview,notes:['JSONL conforms to the proposed schema, not yet verified against the live collection.','The current frontend assumes RON and NEW; do not publish unresolved sample offers to live search.','Null optional values appear in normalized.json; they are omitted in Typesense JSONL.','Source freshness is unknown. prepared_at is a build audit timestamp, not product freshness.']};
 write('validation.json',report);write('audit.json',result.audit);write('proposed-schema.json',typesenseSchema());write('schema-review.json',schemaReview);
 if(result.errors.length){process.exitCode=1;console.error(`Validation failed for ${result.errors.length} records. No JSONL generated.`);return;}
 write('normalized.json',result.records);write('example-product.json',documents[0]);
 const jsonl=documents.map(doc=>JSON.stringify(doc)).join('\n')+'\n';fs.writeFileSync(path.join(out,'products.jsonl'),jsonl);
 write('manifest.json',{record_count:100,input_sha256:sha256(inputBytes),jsonl_sha256:sha256(jsonl),normalizer_sha256:sha256(fs.readFileSync(path.join(__dirname,'normalize.cjs'))),identity_version:'dwyn-affiliate-v1',upload_performed:false});
 console.log(JSON.stringify({output:out,records:100,warnings:counts,currency_unresolved:report.currency_unresolved,publication_ready:false,network_requests:0},null,2));
}
try{main()}catch(error){console.error(error.message);process.exitCode=1;}
