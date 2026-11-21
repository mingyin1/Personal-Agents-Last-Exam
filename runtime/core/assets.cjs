'use strict';
// Small, self-contained asset bundles. Bytes commit with the App state, never by a caller's filesystem path.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {compile}=require('./schema.cjs'),{copy,fail}=require('./helpers.cjs');
const contract=require('../contracts/validate.cjs'),{extensions}=require('./contribution.cjs');
const base=path.join(__dirname,'schemas'),read=p=>JSON.parse(fs.readFileSync(p,'utf8'));
const schema=read(path.join(base,'bundle.schema.json')),valid=compile(schema,base);
const profile=require('../profiles/local-reference.json');
const MAX_BYTES=profile.max_bundle_bytes;
function validateContract(kind,value){try{contract.validate(kind,value);extensions(value);}catch(e){fail('invalid_bundle',e.message);}}
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
function decode(value){
 if(typeof value!=='string'||value.length>1398104||value.length%4||!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value))throw new Error('Invalid canonical base64');
 const b=Buffer.from(value,'base64');if(b.toString('base64')!==value)throw new Error('Invalid canonical base64');return b;
}
function mimeMatches(b,type){
 if(type==='application/pdf')return b.length>=20&&/^%PDF-[12]\.[0-9]/.test(b.toString('ascii',0,8))&&/%%EOF\s*$/.test(b.toString('ascii',Math.max(0,b.length-1024)));
 if(type==='text/plain'||type==='text/calendar'){try{const t=new TextDecoder('utf-8',{fatal:true}).decode(b);return !t.includes('\0')&&(type==='text/plain'||/^BEGIN:VCALENDAR\r?\n/.test(t)&&/END:VCALENDAR\r?\n?$/.test(t));}catch{return false;}}
 if(type==='image/png')return b.length>=33&&b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))&&b.toString('ascii',12,16)==='IHDR';
 if(type==='image/jpeg')return b.length>4&&b[0]===255&&b[1]===216&&b[2]===255&&b[b.length-2]===255&&b[b.length-1]===217;
 if(type==='audio/mpeg')return b.length>4&&(b.toString('ascii',0,3)==='ID3'||b[0]===255&&(b[1]&224)===224);
 if(type==='audio/wav')return b.length>=44&&b.toString('ascii',0,4)==='RIFF'&&b.toString('ascii',8,12)==='WAVE';
 if(type==='video/mp4')return b.length>=16&&b.toString('ascii',4,8)==='ftyp';
 if(type==='application/json'){try{JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(b));return true;}catch{return false;}}
 return false;
}
function display(a,dataset){
 const source=dataset.sources.find(s=>s.source_id===a.provenance.source_ids[0]);
 return {asset_id:a.asset_id,app_id:a.scope.app_id,owner:a.subjects[0]||{},filename:path.basename(a.storage.path||a.asset_id),mime_type:a.mime_type,bytes:a.integrity?.bytes??null,sha256:a.integrity?.sha256??null,availability:a.availability.status,access:a.access.audience.includes('agent')?'agent':'evaluator',source:{source_id:source?.source_id,kind:source?.kind},...a.media?.image,...a.media?.audio,...a.media?.video,...a.media?.sensor};
}
function inspect(pkg,data,bundle,{strictCounts=true,strictOwners=true,runId}={}){
 const checks=[],warnings=[],add=(name,ok,detail='')=>checks.push({name,status:ok?'pass':'fail',detail});
 if(!valid(bundle))fail('invalid_bundle','Asset bundle does not match the shared bundle / dataset / asset-descriptor schemas.');
 const d=bundle.dataset,assets=bundle.catalog.assets,records=pkg.plugin.records(data),objects=new Set(pkg.plugin.objects(data)),refs=pkg.plugin.assetReferences?.(data)||[];
 const sources=new Map(d.sources.map(s=>[s.source_id,s])),ids=new Map(assets.map(a=>[a.asset_id,display(a,d)]));
 validateContract('asset-catalog',bundle.catalog);validateContract('dataset',d);
 add('catalog_app',bundle.catalog.app_id===pkg.manifest.app_id);add('asset_count_limit',assets.length<=profile.max_assets);
 add('unique_source_ids',sources.size===d.sources.length);add('unique_asset_ids',ids.size===assets.length);
 add('app_resource_capability',pkg.manifest.capabilities.resources||assets.length===0);
 add('record_provenance',d.record_source_ids.every(id=>sources.has(id)));
 for(const s of d.sources){
  add('source:'+s.source_id,s.kind==='synthetic'?!!s.generation:s.kind==='collected'?!!s.uri&&!!s.collection:s.kind==='reused'?!!s.uri:true,'Synthetic needs generation details; collected needs URI + collection; reused needs URI.');
  if(s.kind==='unspecified'||s.usage==='review_required')warnings.push('Source '+s.source_id+' is awaiting provenance / usage review.');
 }
 add('review_record',d.review.status!=='approved'||!!d.review.reviewer,'Approved reviews must identify their reviewer.');
 const actual={records:records.length,assets:assets.length,ready_assets:0,declared_missing:0,total_bytes:0};
 if(strictCounts)add('expected_counts',d.expected_counts.records===actual.records&&d.expected_counts.assets===actual.assets);
 const readyIds=new Set(),hashes=new Set();let duplicateAssets=0;
 for(const descriptor of assets){
  validateContract('asset-descriptor',descriptor);
  const a=display(descriptor,d),content=descriptor.roles.some(r=>r==='content.attachment'||r==='content.inline');
  add('asset_provenance:'+a.asset_id,descriptor.provenance.dataset_id===d.dataset_id&&descriptor.provenance.source_ids.every(id=>sources.has(id)));
  add('asset_run:'+a.asset_id,descriptor.scope.level!=='run'||runId===undefined||descriptor.scope.run_id===runId);
  add('access_rule:'+a.asset_id,descriptor.access.rule==='parent_object'||descriptor.access.rule==='app_surface'&&!content);
  add('subject_app:'+a.asset_id,descriptor.subjects.every(x=>x.app_id===pkg.manifest.app_id));
  add('implemented_storage:'+a.asset_id,descriptor.availability.status!=='ready'||profile.storage_adapters.includes(descriptor.storage.adapter));
  const source=sources.get(a.source.source_id);
  add('asset_source:'+a.asset_id,!!source&&source.kind===a.source.kind);
  add('asset_app:'+a.asset_id,a.app_id===pkg.manifest.app_id);
  if(strictOwners&&content)add('asset_owner:'+a.asset_id,descriptor.subjects.length===1&&a.owner.account_id===data.account_id&&objects.has(a.owner.object_id));
  if(a.availability!=='ready'){
   actual.declared_missing++;add('declared_missing:'+a.asset_id,a.bytes===null&&a.sha256===null&&!Object.hasOwn(bundle.blobs,a.asset_id)&&d.quality_policy.missing_assets==='allow_declared');
   warnings.push('Explicitly missing asset: '+a.asset_id);continue;
  }
  readyIds.add(a.asset_id);actual.ready_assets++;
  let b;try{b=decode(bundle.blobs[a.asset_id]);if(descriptor.storage.adapter==='storage.inline'&&descriptor.storage.inline_base64!==bundle.blobs[a.asset_id])throw new Error('Inline payload mismatch');}catch{add('bytes:'+a.asset_id,false,'Missing or invalid base64');continue;}
  actual.total_bytes+=b.length;add('bytes:'+a.asset_id,b.length===a.bytes&&sha(b)===a.sha256,'Size and SHA-256 must match the actual bytes.');
  add('declared_mime:'+a.asset_id,pkg.contribution.declaration.asset_runtime.implemented_mime_types.includes(a.mime_type),'App must declare supported formats.');
  add('mime:'+a.asset_id,mimeMatches(b,a.mime_type),'File signature / JSON syntax check; not a full media decoder.');
  if(a.mime_type==='image/png'&&mimeMatches(b,a.mime_type))add('dimensions:'+a.asset_id,a.width===b.readUInt32BE(16)&&a.height===b.readUInt32BE(20));
  if(a.mime_type==='image/jpeg')add('image_metadata:'+a.asset_id,Number.isInteger(a.width)&&Number.isInteger(a.height));
  if(a.mime_type.startsWith('audio/')||a.mime_type==='video/mp4')add('media_metadata:'+a.asset_id,Number.isInteger(a.duration_ms)&&!!a.codec);
  if(a.mime_type==='video/mp4')add('video_metadata:'+a.asset_id,Number.isInteger(a.width)&&Number.isInteger(a.height)&&typeof a.fps==='number'&&typeof a.has_audio==='boolean');
  if(a.mime_type.startsWith('audio/'))add('audio_metadata:'+a.asset_id,Number.isInteger(a.sample_rate_hz)&&Number.isInteger(a.channels));
  if(a.mime_type==='application/json'&&a.unit){try{const x=JSON.parse(b);add('sensor_samples:'+a.asset_id,Array.isArray(x.samples)&&x.samples.length===a.sample_count&&x.unit===a.unit);}catch{add('sensor_samples:'+a.asset_id,false);}}
  if(hashes.has(a.sha256))duplicateAssets++;hashes.add(a.sha256);
 }
 add('blob_ids',Object.keys(bundle.blobs).every(id=>readyIds.has(id))&&Object.keys(bundle.blobs).length===readyIds.size,'Only ready catalog assets may have byte payloads.');
 add('bundle_size',actual.total_bytes<=MAX_BYTES,'Maximum decoded bytes: '+MAX_BYTES);
 for(const r of refs){const a=ids.get(r.asset_id);add('attachment:'+r.object_id+':'+r.asset_id,!!a&&a.owner.account_id===data.account_id&&a.owner.object_id===r.object_id&&a.owner.object_type===r.object_type,'Attachment must resolve to an asset owned by the same parent object.');}
 const canonical=x=>{if(Array.isArray(x))return x.map(canonical);if(x&&typeof x==='object')return Object.fromEntries(Object.keys(x).sort().map(k=>[k,canonical(x[k])]));return x;};
 const fingerprints=records.map(x=>JSON.stringify(canonical(Object.fromEntries(Object.entries(x).filter(([k])=>!['id','uid'].includes(k))))));
 const duplicateRecords=fingerprints.length-new Set(fingerprints).size;
 add('duplicate_records',!duplicateRecords||d.quality_policy.duplicate_records==='allow',duplicateRecords+' duplicate record bodies (id / uid excluded).');
 add('duplicate_assets',!strictCounts||!duplicateAssets||d.quality_policy.duplicate_assets==='allow',duplicateAssets+' repeated byte hashes.');
 if(duplicateRecords)warnings.push('Duplicate records: '+duplicateRecords+'; handled according to the declared policy.');
 if(duplicateAssets)warnings.push('Duplicate assets: '+duplicateAssets+'; handled according to the declared policy.');
 if(d.review.status==='pending')warnings.push('Realism, variation and licensing still require human review.');
 const passed=checks.every(x=>x.status==='pass');
 return {schema_version:'pale.quality.v1',automated_pass:passed,submission_ready:passed&&d.review.status!=='pending'&&d.sources.every(s=>s.kind!=='unspecified'&&s.usage==='permitted'),dataset_id:d.dataset_id,counts:actual,checks,warnings,review:copy(d.review)};
}
function check(pkg,data,bundle,options){
 const report=inspect(pkg,data,bundle,options);if(!report.automated_pass)throw Object.assign(new Error('Asset bundle validation failed: '+report.checks.filter(x=>x.status==='fail').map(x=>x.name).join(', ')),{code:'invalid_bundle',quality:report});
 return {bundle:copy(bundle),quality:report};
}
function fromPackage(pkg,inside){
 const catalog=pkg.resources?.catalog||pkg.contribution?.catalog,blobs={};
 if(!catalog)fail('invalid_bundle','Canonical asset catalog is required');
 for(const a of catalog.assets){
  validateContract('asset-descriptor',a);
  if(a.availability.status==='ready'){
   if(a.storage.adapter==='storage.inline')blobs[a.asset_id]=a.storage.inline_base64;
   else if(a.storage.adapter==='storage.file'){
    const f=inside(pkg.dir,a.storage.path),allowed=fs.realpathSync(pkg.resources.directory),stat=fs.statSync(f);
    if(!f.startsWith(allowed+path.sep)||!stat.isFile()||stat.size>MAX_BYTES)fail('invalid_bundle','Asset must be inside approved assets directory and within size limit');
    blobs[a.asset_id]=fs.readFileSync(f).toString('base64');
   }else fail('invalid_bundle','Storage adapter is not implemented');
  }
 }
 return {dataset:pkg.dataset,catalog,blobs};
}
function legacy(pkg,data,previous,priorAccount){
 // Compatibility record imports cannot claim to have the old fixture's provenance.
 const bundle=copy(previous.bundle),ids=new Set(pkg.plugin.objects(data));
 bundle.catalog.assets=bundle.catalog.assets.filter(a=>!a.subjects.length||a.subjects.some(x=>ids.has(x.object_id)));
 for(const a of bundle.catalog.assets)for(const subject of a.subjects)if(subject.account_id===priorAccount)subject.account_id=data.account_id;
 bundle.blobs=Object.fromEntries(Object.entries(bundle.blobs).filter(([id])=>bundle.catalog.assets.some(a=>a.asset_id===id&&a.availability.status==='ready')));
 const d=bundle.dataset,sourceId='runtime-record-import';
 d.sources=d.sources.filter(s=>s.source_id!==sourceId);d.sources.push({source_id:sourceId,kind:'unspecified',description:'Records loaded through compatible env.load_seed; the caller supplied no provenance description.',uri:null,license:'UNSPECIFIED',usage:'review_required',collection:null,generation:null});
 d.record_source_ids=[sourceId];d.dataset_id=pkg.manifest.app_id+'-runtime-import';d.expected_counts={records:pkg.plugin.objects(data).length,assets:bundle.catalog.assets.length};d.review={status:'pending',reviewer:null,notes:'Provide a complete bundle before contribution acceptance.'};
 for(const a of bundle.catalog.assets)a.provenance.dataset_id=d.dataset_id;
 d.transformations.push('Record-only import; asset bytes retained for surviving parent objects.');
 return bundle;
}
module.exports={schema,MAX_BYTES,decode,mimeMatches,display,inspect,check,fromPackage,legacy};
