'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {spawnSync}=require('node:child_process');
const {prepare}=require('./prepare.cjs'),{Client}=require('./client.cjs');
function digestTree(root){
 const hash=crypto.createHash('sha256');
 function walk(dir){for(const e of fs.readdirSync(dir,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){const p=path.join(dir,e.name);if(e.isSymbolicLink())throw Error('App verification does not accept symbolic links');if(e.isDirectory())walk(p);else{hash.update(path.relative(root,p).split(path.sep).join('/'));hash.update('\0');hash.update(fs.readFileSync(p));}}}
 walk(root);return hash.digest('hex');
}
async function verify(appDirectory,{dependencies=[]}={}){
 const source=fs.realpathSync(appDirectory),packageHash=digestTree(source),prepared=prepare(source,dependencies),clients=[],checks=[],stages=[];
 const pkg=prepared.model.get(prepared.app),report={schema:'pale.app-verification.v1',runtime_version:require('./package.json').version,core_api_version:prepared.model.registry.api,app_id:prepared.app,app_version:pkg.manifest.version,package_sha256:packageHash,node:process.version,verified_at:new Date().toISOString(),checks,stages,passed:false};
 const check=(name,condition)=>{assert.ok(condition,name);checks.push({name,status:'passed'});};
 const equal=(name,a,b)=>{assert.deepEqual(a,b,name);checks.push({name,status:'passed'});};
 const clone=x=>structuredClone(x);
 async function client(role,run='verify'){
  const c=new Client(prepared.app,role,run,path.join(prepared.root,'state'),'public-app-verification',{registry:prepared.registry});clients.push(c);await c.initialize();return c;
 }
 try{
  check('Manifest, schemas, seed, references, media and declarations load',true);
  // Run App-only evidence without a runtime sibling, installed packages, or host imports.
  for(const [name,entry,args] of [['business','tests/business.test.cjs',['--test']],['event-example','examples/run.cjs',[]]]){
   const file=path.join(pkg.dir,entry);
   if(!fs.existsSync(file)){stages.push({name,status:'not_run',reason:entry+' not provided; attach documented alternative evidence'});continue;}
   const result=spawnSync(process.execPath,[...args,file],{cwd:pkg.dir,env:{PATH:process.env.PATH||'',LANG:'en_US.UTF-8'},encoding:'utf8',timeout:60000,maxBuffer:4*1024*1024});
   stages.push({name,status:result.status===0?'passed':'failed',exit_code:result.status,output:result.stdout,errors:result.stderr});
   check(name+' standalone command succeeds',result.status===0);
  }
  const infra=await client('infra'),agent=await client('agent'),snapshot=await infra.call('env.snapshot');
  const list=(await agent.request('tools/list')).result.tools;
  check('Agent discovery excludes administrative tools',list.every(t=>!t.name.startsWith('env.')));
  for(const tool of list)equal('Published input/output for '+tool.name,[tool.inputSchema,tool.outputSchema],[pkg.tools.find(t=>t.name===tool.name).inputSchema,pkg.tools.find(t=>t.name===tool.name).outputSchema]);
  const management=(await infra.request('tools/list')).result.tools.map(t=>t.name);
  equal('Infra exposes the lifecycle interface and host clock operation',management.sort(),[...require('./core/admin-tools.cjs').operations].sort());
  for(const name of management)check('Agent cannot call '+name,(await agent.call(name,{})).status==='permission_denied');
  const cases=JSON.parse(fs.readFileSync(path.join(pkg.dir,'tests/cases.json'),'utf8'));
  const response=await agent.request('tools/call',{name:cases.read.name,arguments:cases.read.args});
  check('Real MCP business read succeeds',response.result&&!response.result.isError&&response.result.structuredContent.status==='ok');
  equal('MCP content and structured result agree',JSON.parse(response.result.content[0].text),response.result.structuredContent);
  equal('MCP envelope remains unchanged',Object.keys(response.result).sort(),['content','isError','structuredContent']);
  equal('Read does not change business data',(await infra.call('env.snapshot')).snapshot.data,snapshot.snapshot.data);
  check('Caller cannot override run or role',(await agent.call(cases.read.name,{...cases.read.args,role:'infra',run_id:'other'})).status==='invalid_arguments');
  const bundle=clone(snapshot.snapshot.resources.bundle),loaded=await infra.call('env.load_seed',{expected_version:snapshot.version,request_id:'baseline',data:clone(snapshot.snapshot.data),binding:clone(snapshot.snapshot.binding),policies:clone(snapshot.snapshot.policies),bundle});
  check('Infra loads history, relationships and assets',loaded.status==='ready');
  const seedSnapshot=await infra.call('env.snapshot');
  equal('Loaded historical records match input',seedSnapshot.snapshot.data,snapshot.snapshot.data);
  const invalidData=clone(seedSnapshot.snapshot.data);invalidData.account_id='unbound-account';
  check('Invalid history is rejected',(await infra.call('env.load_seed',{expected_version:seedSnapshot.version,data:invalidData})).status!=='ready');
  equal('Rejected history leaves business state unchanged',(await infra.call('env.snapshot')).snapshot.data,seedSnapshot.snapshot.data);
  const eventFile=path.join(pkg.dir,'examples/scenario.json');
  if(pkg.manifest.event_types.length){
   const event=JSON.parse(fs.readFileSync(eventFile,'utf8')),args={expected_version:seedSnapshot.version,event};
   const applied=await infra.call('env.apply_event',args);check('Declared incoming event commits',applied.status==='committed');
   const after=await infra.call('env.snapshot');check('Event changes business data',JSON.stringify(after.snapshot.data)!==JSON.stringify(seedSnapshot.snapshot.data));
   equal('Committed event is queryable',(await infra.call('env.event_status',{event_id:event.event_id})).receipt,applied);
   check('Identical event retry is deduplicated',(await infra.call('env.apply_event',args)).duplicate===true);
   equal('Duplicate has no additional state change',(await infra.call('env.snapshot')).version,after.version);
   const conflict=clone(event);conflict.at='2099-01-01T00:00:00Z';check('Same event ID with changed content is rejected',(await infra.call('env.apply_event',{expected_version:after.version,event:conflict})).status==='idempotency_conflict');
   check('Old version cannot reset a changed App',(await infra.call('env.reset',{expected_version:seedSnapshot.version})).status==='stale_version');
  }else stages.push({name:'incoming-events',status:'not_applicable',reason:'No incoming events declared'});
  const peer=await client('infra','other-run');equal('A separate run retains its own initial data',(await peer.call('env.snapshot')).snapshot.data,snapshot.snapshot.data);
  const beforeReset=await infra.call('env.snapshot'),reset=await infra.call('env.reset',{expected_version:beforeReset.version});check('Reset returns ready',reset.status==='ready');
  const restored=await infra.call('env.snapshot');equal('Reset restores the loaded business baseline',restored.snapshot.data,seedSnapshot.snapshot.data);check('Reset advances epoch',restored.version.epoch>beforeReset.version.epoch);
  await agent.close();const restarted=await client('agent');check('New MCP process reads persisted App state',(await restarted.call(cases.read.name,cases.read.args)).status==='ok');
  check('Submitted package remains unchanged',digestTree(source)===packageHash);
  report.passed=stages.every(x=>x.status==='passed'||x.status==='not_applicable');
  report.remaining=['App-specific approved workflow coverage','Human data/media/provenance review','Production remote authentication and deployment checks when applicable'];
  if(stages.some(s=>s.status==='not_run'))report.remaining.push('Provide missing standalone test/example evidence');
 }catch(e){report.error=e.message;report.passed=false;}finally{await Promise.allSettled(clients.map(c=>c.close()));prepared.cleanup();}
 return report;
}
module.exports={verify,digestTree};
