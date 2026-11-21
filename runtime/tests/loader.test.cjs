'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const {prepare}=require('../prepare.cjs'),{createRuntime}=require('../core/runtime.cjs'),{Client}=require('../client.cjs');
const root=path.resolve(__dirname,'../..'),source=path.join(root,'examples/apps/mail');
function mutate(file,fn){const data=JSON.parse(fs.readFileSync(file));fn(data);fs.writeFileSync(file,JSON.stringify(data));}
for(const [label,file,change] of [
 ['incompatible Core version','app.json',x=>x.core_api_version='9.0.0'],
 ['escaping plugin path','app.json',x=>x.entrypoint='../../outside.cjs'],
 ['missing dependency','app.json',x=>x.dependencies=[{app_id:'missing',version:'1.2.0'}]],
 ['duplicate tool','tools.json',x=>x.push(x[0])],
 ['management operation in Agent catalog','tools.json',x=>x[0].name='env.reset'],
 ['write without version','tools.json',x=>x.find(t=>!t.read_only).inputSchema.required=[]],
 ['unsupported schema keyword','schemas/seed.schema.json',x=>x.unevaluatedProperties=false],
 ['cross-account history','fixtures/minimal.json',x=>x.messages[0].account_id='another'],
 ['declared operation missing implementation mapping','contribution/contribution.json',x=>x.interfaces[0].operations.pop()]
])test('loader rejects '+label,()=>{const p=prepare(source);try{mutate(path.join(p.root,'apps/mail',file),change);assert.throws(()=>createRuntime({registryFile:p.registry}));}finally{p.cleanup();}});
test('existing JSON outside documented additive capability changes remains unchanged',()=>{
 const base=require('./fixtures/compatibility/app-v1.0-fingerprints.json'),updated=require('./fixtures/compatibility/app-v1.2-contracts.json');
 for(const [file,sha]of Object.entries(base.sha256)){
  if(updated.files[file])continue;
  let bytes=fs.readFileSync(path.join(root,file));
  if(/^examples\/apps\/(mail|calendar)\/contribution\/gui\.json$/.test(file)){
   const gui=JSON.parse(bytes),web=gui.extensions.filter(e=>e.namespace==='pale.web');
   assert.equal(web.length,1);assert.equal(web[0].required,false);assert.equal(web[0].version,'1');
   assert.deepEqual(web[0].data,{page:'gui/index.html',controller:'gui/src/app.js',audience:['agent','user'],host:'runtime/web/server.cjs',transport:'agent-mcp-bridge',status:'implemented'});
   // Remove only the documented optional Web Host extension; freeze the entire original renderer contract.
   gui.extensions=gui.extensions.filter(e=>e.namespace!=='pale.web');bytes=Buffer.from(JSON.stringify(gui,null,2)+'\n');
  }
  assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),sha,file);
 }
});
test('same read schema cannot hide a mutating App handler',()=>{const m=createRuntime(),pkg=m.get('mail'),original=pkg.plugin.handleTool,state=m.create('mail');try{pkg.plugin.handleTool=(ctx,data)=>{data.messages[0].body='mutated';return {data,result:{}};};const out=m.execute(state,'agent','mail.get',{id:'materials'});assert.equal(out.result.status,'invalid_plugin_result');assert.deepEqual(out.state.data,state.data);}finally{pkg.plugin.handleTool=original;}});
test('published service.cjs starts directly from its existing example directory',async()=>{const state=fs.mkdtempSync(path.join(os.tmpdir(),'pale-service-entry-')),clients=[];try{for(const app of ['mail','calendar']){const c=new Client(app,'infra','entry',state,'service-entry',{service:path.join(root,'examples/apps',app,'service.cjs')});clients.push(c);await c.initialize();assert.equal((await c.call('env.snapshot')).snapshot.app_id,app);}}finally{await Promise.allSettled(clients.map(c=>c.close()));fs.rmSync(state,{recursive:true,force:true});}});

test('existing business tool schemas and text messaging contracts remain compatible',()=>{const base=require('./fixtures/compatibility/app-v1.2-contracts.json').files;for(const app of ['mail','calendar']){const dir='examples/apps/'+app+'/';const tools=JSON.parse(fs.readFileSync(path.join(root,dir+'tools.json')));for(const old of base[dir+'tools.json'])assert.deepEqual(tools.find(t=>t.name===old.name),old);const state=JSON.parse(fs.readFileSync(path.join(root,dir+'schemas/state.schema.json')));state.properties.package_version.const='1.2.0';delete state.properties.initial_virtual_now;assert.deepEqual(state,base[dir+'schemas/state.schema.json']);const model=createRuntime(),s=model.create(app);s.package_version='1.2.0';assert.equal(model.normalize(s).package_version,'1.3.0');}});
