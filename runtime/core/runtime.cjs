'use strict';
const path=require('node:path'),{load,read,inside}=require('./registry.cjs'),{compile}=require('./schema.cjs'),{copy,version,fail,freeze}=require('./helpers.cjs');
const assets=require('./assets.cjs');
const cloudEvents=require('./cloud-events.cjs');
const bundleSchema=read(path.join(__dirname,'schemas/bundle.schema.json'));

const str={type:'string'},shape=(p={},required=Object.keys(p))=>({type:'object',properties:p,required,additionalProperties:false});
const ver=shape({epoch:{type:'integer',minimum:1},revision:{type:'integer',minimum:0}});
const bindingSchema=read(path.join(__dirname,'schemas/binding.schema.json'));
const policySchema=read(path.join(__dirname,'schemas/policies.schema.json'));
const {operations:admin}=require('./admin-tools.cjs');
function createRuntime({registryFile,assemblyFile}={}){
 const registry=load(registryFile),configs=new Map();
 for(const [id,pkg] of registry.apps)configs.set(id,{...copy(pkg.fixtures),bundle:copy(pkg.bundle)});
 if(assemblyFile){const a=read(assemblyFile),used=new Set();if(a.schema_version!==1||!Array.isArray(a.apps))throw new Error('Invalid assembly');
  for(const row of a.apps){const p=registry.apps.get(row.app_id);if(!p||used.has(row.app_id)||p.manifest.version!==row.version)throw new Error('Assembly version / app mismatch');used.add(row.app_id);
   const c=configs.get(row.app_id);for(const key of ['seed','binding','policies'])if(row[key])c[key]=read(inside(registry.root,row[key]));if(row.bundle)c.bundle=read(inside(registry.root,row.bundle));}
  for(const id of configs.keys())if(!used.has(id))configs.delete(id);
 }
 const get=id=>{if(!configs.has(id))fail('invalid_configuration','App not enabled in assembly');return registry.apps.get(id);};
 function context(s,log,withAssets=false){const ctx=copy({app_id:s.app_id,run_id:s.run_id,role:'agent',binding:s.binding,policy:s.policies[s.profile],virtual_now:s.virtual_now});if(typeof log==='function')ctx.log=log;if(withAssets)ctx.assets=require('./attachment-context.cjs').create(s,get(s.app_id));return freeze(ctx);}
 const validBinding=compile(bindingSchema,__dirname),validPolicies=compile(policySchema,__dirname);
 function checkConfig(pkg,binding,policies){
  if(!validBinding(binding)||new Set(binding.people.map(x=>x.person_id)).size!==binding.people.length||new Set(binding.accounts.map(x=>x.app_id+':'+x.account_id)).size!==binding.accounts.length||binding.accounts.some(x=>!binding.people.some(p=>p.person_id===x.owner_person_id)))fail('invalid_seed','Invalid identity binding');
  if(!validPolicies(policies)||!policies.scenario||!policies.sandbox)fail('invalid_configuration','Policies require scenario and sandbox profiles');
  for(const p of Object.values(policies)){if(p.allow.some(n=>!pkg.tools.some(t=>t.name===n))||Object.keys(p.constraints).some(n=>!p.allow.includes(n)))fail('invalid_configuration','Policy references an undeclared tool');}
 }
 function validateData(s,data,code='invalid_seed'){
  const p=get(s.app_id);if(!p.validators.seed(data))fail(code,'Data does not match '+p.manifest.schemas.seed);
  p.plugin.validateSeed(context(s),data);
 }
 function create(app,run='run-demo',profile='scenario',epoch=1){
  const p=get(app),c=configs.get(app);if(!/^[-a-zA-Z0-9_]{1,80}$/.test(run)||!c.policies[profile])fail('invalid_configuration','Invalid run / profile');
  checkConfig(p,c.binding,c.policies);
  const s={schema:'pale.app-state.v1',schema_version:1,package_version:p.manifest.version,core_api_version:registry.api,app_id:app,run_id:run,epoch,revision:0,profile,next_id:1,virtual_now:registry.initialTime,initial_virtual_now:registry.initialTime,binding:copy(c.binding),policies:copy(c.policies),initial_data:copy(c.seed),data:copy(c.seed),resources:assets.check(p,c.seed,c.bundle),initial_resources:assets.check(p,c.seed,c.bundle),receipts:{},audit:[]};
  validateData(s,s.data);return s;
 }
 function normalize(raw){
  const p=get(raw.app_id);let s=raw;
  if(s.schema==='pale.local-lite.state.v1'&&!s.package_version){s={...create(s.app_id,s.run_id,s.profile,s.epoch),...copy(raw),schema:'pale.app-state.v1'};}
  else if(s.schema==='pale.app-state.v1'&&s.package_version==='1.0.0'&&s.core_api_version==='1.0.0'){
   const current=create(s.app_id,s.run_id,s.profile,s.epoch),prior=s.initial_data||s.data;
   s={...copy(s),package_version:p.manifest.version,core_api_version:registry.api,
    resources:assets.check(p,s.data,assets.legacy(p,s.data,current.resources,current.data.account_id)),
    initial_resources:assets.check(p,prior,assets.legacy(p,prior,current.initial_resources,current.data.account_id))};
  }
  if(s.schema==='pale.app-state.v1'&&s.package_version==='1.1.0'&&s.core_api_version==='1.1.0'){
   s=copy(s);const migrate=require('./migrate-assets.cjs').bundle;
   s.resources=assets.check(p,s.data,migrate(s.resources.bundle,s.app_id),{strictCounts:false,strictOwners:false,runId:s.run_id});
   s.initial_resources=assets.check(p,s.initial_data,migrate(s.initial_resources.bundle,s.app_id),{runId:s.run_id});
   s.package_version=p.manifest.version;s.core_api_version=registry.api;
  }
  if(typeof p.plugin.migrateState==='function')s=p.plugin.migrateState(copy(s),{package_version:p.manifest.version,core_api_version:registry.api});
  if(s.initial_virtual_now===undefined)s={...s,initial_virtual_now:registry.initialTime};
  if(s.schema!=='pale.app-state.v1'||s.package_version!==p.manifest.version||s.core_api_version!==registry.api||!p.validators.state(s))fail('invalid_state','Stored state/schema/package version mismatch');
  checkConfig(p,s.binding,s.policies);validateData(s,s.data);
  assets.check(p,s.data,s.resources.bundle,{strictCounts:false,strictOwners:false});
  return s;
 }
 function tools(s,role){return role==='infra'?admin.slice():role==='agent'?get(s.app_id).tools.filter(t=>s.policies[s.profile].allow.includes(t.name)).map(t=>t.name):[];}
 function adminSchemas(app){const p=get(app);return {
  'env.reset':shape({expected_version:ver,profile:{type:'string',enum:Object.keys(configs.get(app).policies)}},['expected_version']),
  'env.load_seed':shape({expected_version:ver,data:read(path.join(p.dir,p.manifest.schemas.seed)),binding:bindingSchema,policies:policySchema,bundle:bundleSchema,virtual_now:{type:'string',format:'date-time'},request_id:{type:'string',minLength:1}},['expected_version','data']),
  'env.apply_event':shape({expected_version:ver,event:read(path.join(p.dir,p.manifest.schemas.events)),bundle:bundleSchema},['expected_version','event']),
  'env.advance_time':shape({expected_version:ver,virtual_now:{type:'string',format:'date-time'},request_id:{type:'string',minLength:1,pattern:'\\S'}}),
  'env.validate_bundle':shape({data:read(path.join(p.dir,p.manifest.schemas.seed)),bundle:bundleSchema,binding:bindingSchema,policies:policySchema},['data','bundle']),
  'env.snapshot':shape(), 'env.event_status':shape({event_id:str})};}
 const adminCompiled=new Map();
 for(const app of configs.keys())adminCompiled.set(app,Object.fromEntries(Object.entries(adminSchemas(app)).map(([n,s])=>[n,compile(s,path.join(get(app).dir,'schemas'))])));
 function definitions(s,role){return tools(s,role).map(name=>{const t=get(s.app_id).tools.find(t=>t.name===name);return t?{name,description:t.description,inputSchema:t.inputSchema,outputSchema:t.outputSchema,annotations:{readOnlyHint:t.read_only}}:{name,description:name==='env.advance_time'?'Infra only: advance the App virtual clock without changing business records or triggering events. Requires an observed version and retry-stable request ID.':'Infra only: '+name,inputSchema:adminSchemas(s.app_id)[name]};});}
 const checkVersion=(s,v)=>{if(!v||v.epoch!==s.epoch||v.revision!==s.revision)fail('stale_version','The observed version is stale; read the current state before retrying.');};
 function execute(original,role,name,args={}, {log}={}){
  const receivedAt=new Date().toISOString();
  const s=copy(original),p=get(s.app_id),before=version(s);let changed=false,result,eventTrace;
  try{
   if(!tools(s,role).includes(name))fail('permission_denied','This operation is not allowed for the current identity or task.');
   const t=p.tools.find(t=>t.name===name),valid=role==='infra'?adminCompiled.get(s.app_id)[name]:t.validateInput;
   if(!valid(args))fail('invalid_arguments','Arguments do not match inputSchema');
   if(name==='env.snapshot')return {state:original,result:{status:'ok',snapshot:copy(original),app_id:s.app_id,version:before}};
   if(name==='env.event_status')result={status:'ok',receipt:copy(s.receipts['event:'+args.event_id]?.result||null)};
   else if(name==='env.advance_time'){
    const key='clock:'+args.request_id,fp=JSON.stringify({virtual_now:args.virtual_now}),prior=s.receipts[key];
    if(prior){if(prior.fingerprint!==fp)fail('idempotency_conflict','The same request_id cannot identify different clock targets.');return {state:original,result:{...copy(prior.result),duplicate:true}};}
    checkVersion(s,args.expected_version);
    const previous=s.virtual_now,target=Date.parse(args.virtual_now),current=Date.parse(previous);
    if(target<current)fail('invalid_time','The App virtual clock cannot move backwards.');
    // Equal instants are acknowledged without changing the revision or stored
    // timezone spelling. No business handler, event or timer is invoked here.
    if(target>current){s.virtual_now=args.virtual_now;s.revision++;changed=true;}
    result={status:'committed',request_id:args.request_id,previous_virtual_now:previous,virtual_now:s.virtual_now,advanced:changed};
    s.receipts[key]={fingerprint:fp,result:{...copy(result),app_id:s.app_id,version:version(s)}};
   }else if(name==='env.reset'){
    checkVersion(s,args.expected_version);s.data=copy(s.initial_data);s.resources=copy(s.initial_resources);s.profile=args.profile||s.profile;s.epoch++;s.revision=0;s.next_id=1;s.virtual_now=s.initial_virtual_now||registry.initialTime;s.audit=[];s.receipts={};changed=true;result={status:'ready',reset_scope:s.app_id};
   }else if(name==='env.load_seed'){
    const key='seed:'+args.request_id,fp=JSON.stringify({data:args.data,binding:args.binding,policies:args.policies,bundle:args.bundle,virtual_now:args.virtual_now});
    if(args.bundle&&!args.request_id)fail('invalid_arguments','Bundle loads require request_id');
    if(args.request_id&&s.receipts[key]){if(s.receipts[key].fingerprint!==fp)fail('idempotency_conflict','The same request_id cannot identify different seed bundles.');return {state:original,result:{...copy(s.receipts[key].result),duplicate:true}};}
    checkVersion(s,args.expected_version);
    if(!args.binding&&args.data.account_id!==s.data.account_id)fail('invalid_seed','Changing account requires an explicit trusted binding');
    s.virtual_now=args.virtual_now||s.virtual_now;s.initial_virtual_now=s.virtual_now;s.binding=copy(args.binding||s.binding);s.policies=copy(args.policies||s.policies);checkConfig(p,s.binding,s.policies);if(!s.policies[s.profile])fail('invalid_configuration','Current profile unavailable');validateData(s,args.data);
    s.resources=assets.check(p,args.data,args.bundle||assets.legacy(p,args.data,s.resources,s.data.account_id),{runId:s.run_id});s.initial_resources=copy(s.resources);
    s.data=copy(args.data);s.initial_data=copy(args.data);s.epoch++;s.revision=0;s.next_id=1;s.audit=[];s.receipts={};changed=true;result={status:'ready',loaded:p.plugin.objects?.(s.data).length||0,quality:copy(s.resources.quality)};if(args.request_id)s.receipts[key]={fingerprint:fp,result:{...copy(result),app_id:s.app_id,version:version(s)}};
   }else if(name==='env.validate_bundle'){
    const candidate={...s,binding:args.binding||s.binding,policies:args.policies||s.policies};checkConfig(p,candidate.binding,candidate.policies);validateData(candidate,args.data);
    const quality=assets.inspect(p,args.data,args.bundle,{runId:s.run_id});result={status:quality.automated_pass?'ok':'invalid_bundle',quality};
   }else if(name==='env.apply_event'){
    const e=args.event,key='event:'+e.event_id,fp=JSON.stringify({event:e,bundle:args.bundle}),prior=s.receipts[key];
    eventTrace={run_id:s.run_id,app_id:s.app_id,event_id:e.event_id,cloud_event:cloudEvents.metadata(e.payload?.message),received_at:receivedAt,virtual_received_at:s.virtual_now,applied_at:null};
    if(!p.manifest.event_types.includes(e.operation))fail('invalid_event','Undeclared event type');
    if(prior){if(prior.fingerprint!==fp)fail('idempotency_conflict','The same event ID cannot identify different content.');return {state:original,result:{...copy(prior.result),duplicate:true}};}
    checkVersion(s,args.expected_version);if(Date.parse(e.at)<Date.parse(s.virtual_now))fail('invalid_event','The App virtual clock cannot move backwards.');
    // Handlers and validation observe the event's logical time. execute() works
    // on a copy, so a failed handler/validation rolls back the clock as well.
    s.virtual_now=e.at;
    s.data=p.plugin.applyEvent(freeze({...context(s,log,true),role:'infra'}),copy(s.data),copy(e));validateData(s,s.data,'invalid_event');if(args.bundle)s.resources=assets.check(p,s.data,args.bundle,{runId:s.run_id});s.revision++;changed=true;result={status:'committed',event_id:e.event_id};
   }else{
    const policy=s.policies[s.profile].constraints[name];if(policy&&(policy.ids&&!policy.ids.includes(args.id)||policy.fields&&args.patch&&Object.keys(args.patch).some(f=>!policy.fields.includes(f))))fail('permission_denied','The object or fields are outside the current task permissions.');
    const key='request:'+args.request_id,fp=JSON.stringify({name,args});
    if(!t.read_only){if(!args.request_id||!args.request_id.trim())fail('invalid_arguments','Writes require a request_id');const prior=s.receipts[key];if(prior){if(prior.fingerprint!==fp)fail('idempotency_conflict','The same request_id cannot identify different requests.');return {state:original,result:{...copy(prior.result),duplicate:true}};}checkVersion(s,args.expected_version);}
    const out=p.plugin.handleTool(context(s,log,true),copy(s.data),name,copy(args));
    if(t.read_only&&(JSON.stringify(out.data)!==JSON.stringify(s.data)||JSON.stringify(s.resources)!==JSON.stringify(original.resources)))fail('invalid_plugin_result','Read tool attempted a business mutation');
    validateData(s,out.data,'invalid_event');s.data=out.data;
    if(!t.read_only){s.revision++;changed=true;}
    result={...out.result,status:t.read_only?'ok':'committed',app_id:s.app_id,version:version(s)};
    if(!t.validateOutput(result))fail('invalid_plugin_result','Result does not match outputSchema');
    if(!t.read_only)s.receipts[key]={fingerprint:fp,result:copy(result)};
   }
   if(changed&&name!=='env.advance_time')s.resources=assets.check(p,s.data,s.resources.bundle,{strictCounts:false,strictOwners:false,runId:s.run_id});
   if(eventTrace){
    // processed_at is the Core decision time, before transport persistence.
    // Messaging records committed_at only after the receiver acknowledges storage.
    eventTrace={...eventTrace,applied_at:s.virtual_now,processed_at:new Date().toISOString()};
    result={...result,trace:copy(eventTrace)};
    const e=args.event;s.receipts['event:'+e.event_id]={fingerprint:JSON.stringify({event:e,bundle:args.bundle}),result:{...copy(result),app_id:s.app_id,version:version(s)}};
   }
   result={...result,app_id:s.app_id,version:version(s)};
   s.audit.push({seq:s.audit.length+1,actor:role,tool:name,decision:'allow',before,after:version(s),state_changed:changed,received_at:receivedAt,wall_time:new Date().toISOString(),virtual_time:s.virtual_now,...(name==='env.advance_time'?{clock:{request_id:args.request_id,from:original.virtual_now,requested:args.virtual_now,to:s.virtual_now}}:{}),...(eventTrace?{trace:copy(eventTrace)}:{})});
   if(!p.validators.state(s))fail('invalid_plugin_result','Resulting App state does not match state schema');
   return {state:s,result};
  }catch(e){const unchanged=copy(original),processedAt=new Date().toISOString();
   if(eventTrace)eventTrace={...eventTrace,applied_at:null,processed_at:processedAt};
   const result={status:e.code||'internal_error',message:e.code?e.message:'App handler failed',applied:false,...(e.quality?{quality:e.quality}:{}),version:before,...(e.code==='stale_version'?{current_version:before}:{}),...(eventTrace?{trace:copy(eventTrace)}:{})};
   unchanged.audit.push({seq:unchanged.audit.length+1,actor:role,tool:name,decision:'deny',reason:result.status,before,after:before,state_changed:false,received_at:receivedAt,wall_time:processedAt,virtual_time:original.virtual_now,...(eventTrace?{trace:copy(eventTrace)}:{})});return {state:unchanged,result};}
 }
 function resource(s,id,catalog=s.resources.bundle.catalog.assets){const p=get(s.app_id),a=catalog.find(a=>a.asset_id===id);if(!require('./resource-access.cjs').allowed(p,s,a))return {status:'not_available',message:'The resource does not exist or is outside the current permissions.'};if(a.availability.status!=='ready')return {status:'unavailable',message:'The attachment is declared but its file is missing; content cannot be inferred.'};return {status:'ok',resource:{...copy(a),run_id:s.run_id,uri:'pale://'+s.run_id+'/'+s.app_id+'/assets/'+id}};}
 // Validate all selected fixture bindings and cross-App targets before starting any process.
 for(const app of configs.keys()){const s=create(app);for(const ref of get(app).plugin.references?.(s.data)||[]){const cfg=configs.get(ref.app_id),other=registry.apps.get(ref.app_id);if(cfg&&(cfg.seed.account_id!==ref.account_id||!other.plugin.objects(cfg.seed).includes(ref.object_id)))fail('invalid_seed','Cross-App fixture reference is dangling');}}
 function resourceBytes(s,id){const r=resource(s,id);if(r.status!=='ok')return r;return {...r,blob:s.resources.bundle.blobs[id]};}
 return {registry,configs,create,normalize,tools,definitions,execute,resource,resourceBytes,copy,version,get};
}
module.exports={createRuntime,bindingSchema,policySchema};
