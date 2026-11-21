'use strict';
function main({fixedApp}={}){
// Local PALE adapter. stdio process identity is set by a trusted launcher.
const fs=require('node:fs'),path=require('node:path'),readline=require('node:readline'),crypto=require('node:crypto');
const {createRuntime}=require('./runtime.cjs');
const appLog=require('./app-log.cjs');
const root=path.resolve(__dirname,'../..');
const opts={};for(let i=2;i<process.argv.length;i+=2){const k=process.argv[i],v=process.argv[i+1];if(!['--app','--role','--run','--state-dir','--registry','--assembly','--initial-profile'].includes(k)||!v){process.stderr.write('Usage: node mcp-server.cjs --app APP_ID --role agent|infra --run RUN [--state-dir DIR] [--initial-profile scenario|sandbox (Infra only)]\n');process.exit(1);}opts[k.slice(2)]=v;}
if(fixedApp&&opts.app&&opts.app!==fixedApp)throw new Error('App entrypoint is fixed');
const app=fixedApp||opts.app,role=opts.role,run=opts.run||'demo';
if(opts['initial-profile'] && (role!=='infra'||!['scenario','sandbox'].includes(opts['initial-profile'])))throw new Error('Initial profile requires Infra and a scenario or sandbox profile');
const registryFile=opts.registry||path.join(root,'examples/registry.json');
const model=createRuntime({registryFile,assemblyFile:opts.assembly});
const pkg=model.get(app);
if(!model.configs.has(app)||!['agent','infra'].includes(role)||!/^[-a-zA-Z0-9_]{1,80}$/.test(run)){process.stderr.write('Invalid fixed app, role or run.\n');process.exit(1);}
const dir=path.resolve(opts['state-dir']||path.join(root,'.state'),run),file=path.join(dir,app+'.json'),lock=path.join(dir,app+'.lock');
fs.mkdirSync(dir,{recursive:true,mode:0o700});
const sleep=new Int32Array(new SharedArrayBuffer(4));
function transaction(fn){
 const deadline=Date.now()+2500;let locked=false;
 while(!locked){try{fs.mkdirSync(lock,{mode:0o700});locked=true;}catch(e){if(e.code!=='EEXIST')throw e;if(Date.now()>deadline)throw Object.assign(new Error('App is locked; retry later. No write was committed.'),{rpcCode:-32001});Atomics.wait(sleep,0,0,10);}}
 try{
  let state,raw=null;
  if(fs.existsSync(file)){raw=fs.readFileSync(file,'utf8');state=model.normalize(JSON.parse(raw));}
  // Choose the initial policy inside the same transaction that creates state.
  // An existing instance always keeps its data and policy, including on restart.
  else if(role==='infra')state=model.create(app,run,opts['initial-profile']||'scenario');
  else throw Object.assign(new Error('Environment not initialized; Infra must start this App first.'),{rpcCode:-32001});
  if(state.run_id!==run||state.app_id!==app)throw new Error('State binding mismatch');
  const {state:next=state,result}=fn(state);
  const encoded=JSON.stringify(next);
  if(encoded!==raw){const tmp=file+'.'+process.pid+'.tmp',fd=fs.openSync(tmp,'w',0o600);
   try{fs.writeFileSync(fd,encoded);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}fs.renameSync(tmp,file);}
  return result;
 }finally{fs.rmdirSync(lock);}
}
if(role==='infra')transaction(s=>({state:s,result:null}));
const protocol='2025-11-25',connectionId=crypto.randomUUID();let initialized=false,ready=false,clientName='unknown';
function decorate(s,from,name,args,result){
 const safeInput=Object.fromEntries(['id','request_id','expected_version','start','end','exclude_id'].filter(k=>args[k]!==undefined).map(k=>[k,args[k]]));
 if(args.event?.event_id)safeInput.event_id=args.event.event_id;
 if(args.patch)safeInput.changed_fields=Object.keys(args.patch);
 const summary={status:result.status,object_id:result.message?.id||result.event?.id||result.id||null};
 if(result.busy)summary.busy_count=result.busy.length;
 if(result.message)summary.read_flag=result.message.read;
 if(result.event)Object.assign(summary,{start:result.event.start,end:result.event.end});
 if(result.messages)summary.message_ids=result.messages.map(x=>x.id);
 for(const row of s.audit.slice(from))Object.assign(row,{wall_time:row.wall_time||new Date().toISOString(),connection_id:connectionId,client_name:clientName,input:safeInput,result:summary});
}
function reply(id,result){process.stdout.write(JSON.stringify({jsonrpc:'2.0',id,result})+'\n');}
function rpcError(id,code,message){process.stdout.write(JSON.stringify({jsonrpc:'2.0',id,error:{code,message}})+'\n');}
function handler(m){
 if(!m||Array.isArray(m)||m.jsonrpc!=='2.0'||typeof m.method!=='string'){rpcError(m?.id??null,-32600,'Invalid request');return;}
 if(m.id===undefined){if(m.method==='notifications/initialized'&&initialized)ready=true;return;}
 if(m.method==='initialize'){
  if(initialized){rpcError(m.id,-32600,'Already initialized');return;}
  if(!m.params||typeof m.params.protocolVersion!=='string'||!m.params.clientInfo||!m.params.capabilities){rpcError(m.id,-32602,'Invalid initialize parameters');return;}
  clientName=String(m.params.clientInfo.name||'unknown').slice(0,100);initialized=true;reply(m.id,{protocolVersion:protocol,capabilities:{tools:{listChanged:false},...(!!pkg.resources&&role==='agent'?{resources:{subscribe:false,listChanged:false}}:{})},serverInfo:{name:'pale-local-lite-'+app+'-'+role,version:pkg.manifest.version},instructions:'Local synthetic environment. Identity, App and run are fixed by the trusted launcher. No real email is sent. Initialize data via a separate Infra process.'});return;
 }
 if(m.method==='ping'){reply(m.id,{});return;}
 if(!ready){rpcError(m.id,-32002,'Send initialize and notifications/initialized first');return;}
 try{
  if(m.method==='tools/list'){
   const result=transaction(s=>({state:s,result:{tools:model.definitions(s,role)}}));reply(m.id,result);
  }else if(m.method==='tools/call'){
   const p=m.params;if(!p||typeof p.name!=='string'||(p.arguments!==undefined&&(!p.arguments||Array.isArray(p.arguments)||typeof p.arguments!=='object'))){rpcError(m.id,-32602,'Invalid tool call');return;}
   let result,diagnostic;
   try{result=transaction(s=>{
    const from=s.audit.length;
    diagnostic=appLog.createCall({state:s,role,tool:p.name,args:p.arguments||{},connection_id:connectionId,rpc_id:m.id});
    const out=model.execute(s,role,p.name,p.arguments||{},{log:diagnostic.log});
    const reset=out.state.epoch!==s.epoch;
    decorate(out.state,reset?0:from,p.name,p.arguments||{},out.result);diagnostic.decided(out);return out;
   });}catch(e){if(diagnostic)appLog.append(dir,app,diagnostic.finish(false));throw e;}
   if(diagnostic)appLog.append(dir,app,diagnostic.finish(true));
   reply(m.id,{content:[{type:'text',text:JSON.stringify(result)}],structuredContent:result,isError:!['ok','committed','ready'].includes(result.status)});
  }else if(m.method==='resources/list'&&!!pkg.resources&&role==='agent'){
   const result=transaction(s=>({state:s,result:{resources:s.resources.bundle.catalog.assets.filter(a=>model.resource(s,a.asset_id).status!=='not_available').map(a=>({uri:'pale://'+run+'/'+app+'/assets/'+a.asset_id,name:require('node:path').basename(a.storage.path||a.asset_id),mimeType:a.mime_type,...(!a.integrity?{}:{size:a.integrity.bytes})}))}}));reply(m.id,result);
  }else if(m.method==='resources/read'&&!!pkg.resources&&role==='agent'){
   const prefix='pale://'+run+'/'+app+'/assets/',uri=m.params?.uri;
   if(typeof uri!=='string'||!uri.startsWith(prefix)){rpcError(m.id,-32002,'Resource not available');return;}
   const id=uri.slice(prefix.length),r=transaction(s=>{const result=model.resourceBytes(s,id);s.audit.push({seq:s.audit.length+1,actor:role,tool:'resources/read',decision:result.status==='ok'?'allow':'deny',asset_id:id,state_changed:false,wall_time:new Date().toISOString(),connection_id:connectionId,client_name:clientName});return {state:s,result};});
   if(r.status!=='ok'){rpcError(m.id,-32002,r.message);return;}
   const a=r.resource,b=Buffer.from(r.blob,'base64');
   reply(m.id,{contents:[{uri,mimeType:a.mime_type,...(a.mime_type==='application/json'?{text:b.toString('utf8')}:{blob:b.toString('base64')})}]});
  }else rpcError(m.id,-32601,'Method not available');
 }catch(e){rpcError(m.id,e.rpcCode||-32603,e.rpcCode?e.message:'Internal local environment error');process.stderr.write(String(e)+'\n');}
}
const input=readline.createInterface({input:process.stdin,crlfDelay:Infinity});
input.on('line',line=>{if(Buffer.byteLength(line)>2*1024*1024){rpcError(null,-32600,'Request too large');return;}let m;try{m=JSON.parse(line);}catch{rpcError(null,-32700,'Parse error');return;}handler(m);});

}
module.exports={main};
