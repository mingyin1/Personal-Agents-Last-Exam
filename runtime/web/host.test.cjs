'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {start}=require('./server.cjs');
const {Client}=require('../client.cjs');
const {spawn}=require('node:child_process');
const {once}=require('node:events');
test('business web boundary: session, origin, fixed role, no hidden files, policy and persisted state',async()=>{
  const stateDir=fs.mkdtempSync(path.join(os.tmpdir(),'pale-web-boundary-'));let host;
  try{
    host=await start({app:'notes',stateDir});
    const post=(route,body,headers={})=>fetch(host.url+route,{method:'POST',headers:{Origin:host.url,'Content-Type':'application/json',...headers},body:JSON.stringify(body)});
    assert.equal((await fetch(host.url+'/api/tools')).status,401);
    assert.equal((await post('/session',{token:'wrong'})).status,403);
    const login=await post('/session',{token:new URLSearchParams(host.accessUrl.split('#')[1]).get('access')});
    assert.equal(login.status,200);const cookie=login.headers.get('set-cookie').split(';')[0],{csrf}=await login.json();
    const headers={Cookie:cookie,'X-Pale-CSRF':csrf};
    assert.equal((await post('/api/call',{name:'notes.list',arguments:{}},{Cookie:cookie})).status,403);
    assert.equal((await post('/api/call',{name:'notes.list',arguments:{}},{...headers,Origin:'https://untrusted.invalid'})).status,403);
    for(const name of ['env.snapshot','env.reset','env.load_seed','env.apply_event'])assert.equal((await post('/api/call',{name,arguments:{}},headers)).status,403);
    assert.equal((await post('/api/call',{name:'notes.list',arguments:{},role:'infra'},headers)).status,400);
    for(const route of ['/api/infra/notes','/fixtures/minimal.json','/.state/web-demo/notes.json','/src/operations.cjs'])assert.equal((await fetch(host.url+route,{headers:{Cookie:cookie}})).status,404);
    const listed=await (await post('/api/call',{name:'notes.list',arguments:{}},headers)).json();
    const args={title:'Browser boundary note',expected_version:listed.version,request_id:'web-test'};
    const written=await (await post('/api/call',{name:'notes.create',arguments:args},headers)).json();
    assert.equal(written.status,'committed');
    assert.equal((await (await post('/api/call',{name:'notes.create',arguments:args},headers)).json()).duplicate,true);
    assert.equal((await (await post('/api/call',{name:'notes.create',arguments:{...args,title:'Stale',request_id:'different'}},headers)).json()).status,'stale_version');
    await host.close();host=null;
    host=await start({app:'notes',stateDir,profile:'scenario'});
    // Restart cannot reset state or silently replace the existing profile.
    const r=await host.client.call('notes.list');
    assert.ok(r.items.some(x=>x.title==='Browser boundary note'));
    await host.close();host=null;
    host=await start({app:'notes',stateDir,run:'restricted',profile:'scenario'});
    const denied=await host.client.call('notes.create',{title:'Forbidden',expected_version:(await host.client.call('notes.list')).version,request_id:'deny'});
    assert.equal(denied.status,'permission_denied');
  }finally{await host?.close();fs.rmSync(stateDir,{recursive:true,force:true});}
});

test('interrupted initializer restarts without a web lock or policy reset', {timeout:15000}, async()=>{
  const stateDir=fs.mkdtempSync(path.join(os.tmpdir(),'pale-web-interrupted-'));
  const options={app:'notes',run:'interrupted',stateDir,profile:'scenario'};
  let child,host;
  try{
    // Stop after Core has initialized, before the Web Host finishes startup.
    // The old Host left its web-init directory behind at this exact point.
    const script=`
      const {Client}=require(${JSON.stringify(require.resolve('../client.cjs'))});
      const initialize=Client.prototype.initialize;
      Client.prototype.initialize=async function(){
        const result=await initialize.call(this);
        if(this.clientName==='pale-web-initializer'){
          process.send('initialized');
          await new Promise(()=>{});
        }
        return result;
      };
      require(${JSON.stringify(require.resolve('./server.cjs'))}).start(${JSON.stringify(options)}).catch(e=>{console.error(e);process.exit(1);});
    `;
    child=spawn(process.execPath,['-e',script],{stdio:['ignore','ignore','pipe','ipc']});
    const initialized=await Promise.race([
      once(child,'message',{signal:AbortSignal.timeout(5000)}),
      once(child,'exit').then(([code,signal])=>{throw Error('Initializer exited early: '+code+' '+signal);})
    ]);
    assert.equal(initialized[0],'initialized');
    const exited=once(child,'exit');child.kill('SIGKILL');await exited;
    const stateFile=path.join(stateDir,options.run,'notes.json');
    const before=fs.readFileSync(stateFile,'utf8');
    assert.equal(JSON.parse(before).profile,'scenario');
    host=await start({...options,profile:'sandbox'});
    assert.equal(fs.readFileSync(stateFile,'utf8'),before);
    assert.equal((await host.client.call('notes.create',{title:'Denied',request_id:'no-escalation',expected_version:{epoch:1,revision:0}})).status,'permission_denied');
    assert.equal(fs.existsSync(path.join(stateDir,options.run,'notes.web-init')),false);
  }finally{
    if(child && child.exitCode===null && child.signalCode===null){const exited=once(child,'exit');child.kill('SIGKILL');await exited;}
    await host?.close();fs.rmSync(stateDir,{recursive:true,force:true});
  }
});

test('concurrent Hosts initialize once and ignore obsolete web-init directories',async()=>{
  const stateDir=fs.mkdtempSync(path.join(os.tmpdir(),'pale-web-concurrent-'));
  const options={app:'notes',run:'concurrent',stateDir};
  const obsolete=path.join(stateDir,options.run,'notes.web-init');
  fs.mkdirSync(obsolete,{recursive:true});
  let hosts=[];
  try{
    const results=await Promise.allSettled(['sandbox','scenario'].map(profile=>start({...options,profile})));
    hosts=results.filter(r=>r.status==='fulfilled').map(r=>r.value);
    for(const result of results)assert.equal(result.status,'fulfilled',result.reason?.stack);
    const state=JSON.parse(fs.readFileSync(path.join(stateDir,options.run,'notes.json')));
    assert.equal(state.epoch,1);assert.equal(state.revision,0);
    assert.ok(['sandbox','scenario'].includes(state.profile));
    assert.equal(state.audit.some(row=>row.tool==='env.reset'),false);
    const lists=await Promise.all(hosts.map(h=>h.client.request('tools/list')));
    assert.deepEqual(lists[0].result,lists[1].result);
    assert.equal(fs.existsSync(obsolete),true,'Do not delete unknown existing lock directories');
  }finally{await Promise.all(hosts.map(h=>h.close()));fs.rmSync(stateDir,{recursive:true,force:true});}
});

test('initial-profile remains a trusted Infra-only startup option',async()=>{
  const stateDir=fs.mkdtempSync(path.join(os.tmpdir(),'pale-web-profile-'));
  try{
    for(const [role,initialProfile] of [['agent','sandbox'],['infra','unknown']]){
      const client=new Client('mail',role,'invalid-profile',stateDir,'invalid-profile-test',{initialProfile});
      try{await assert.rejects(client.initialize(),/Initial profile requires Infra/);}
      finally{await client.close();}
    }
    assert.equal(fs.existsSync(path.join(stateDir,'invalid-profile','mail.json')),false);
  }finally{fs.rmSync(stateDir,{recursive:true,force:true});}
});
