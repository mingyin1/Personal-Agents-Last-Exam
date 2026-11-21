'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {createRuntime}=require('../core/runtime.cjs');
const target='2026-11-20T12:00:00-08:00';
const request=(m,s,id='session-3',time=target)=>({request_id:id,virtual_now:time,expected_version:m.version(s)});
const stable=s=>{const {audit,...rest}=s;return rest;};

test('clock-only advancement preserves business data, resources, history and reset baseline',()=>{
 const m=createRuntime(),initial=m.create('mail','clock-only','sandbox');
 const draft=m.execute(initial,'agent','mail.draft.create',{to:['reviewer@example.com'],subject:'Existing draft',body:'Synthetic',request_id:'draft',expected_version:m.version(initial)});
 assert.equal(draft.result.status,'committed');
 const s=draft.state,out=m.execute(s,'infra','env.advance_time',request(m,s));
 assert.equal(out.result.status,'committed');assert.equal(out.result.advanced,true);
 assert.deepEqual(m.version(out.state),{epoch:s.epoch,revision:s.revision+1});
 assert.equal(out.state.virtual_now,target);assert.equal(out.result.previous_virtual_now,s.virtual_now);
 for(const key of ['data','initial_data','resources','initial_resources','binding','policies','profile','next_id','initial_virtual_now'])assert.deepEqual(out.state[key],s[key],key);
 assert.deepEqual(out.state.receipts['request:draft'],s.receipts['request:draft']);
 assert.deepEqual(out.state.audit.slice(0,-1),s.audit);
 assert.deepEqual(out.state.audit.at(-1).clock,{request_id:'session-3',from:s.virtual_now,requested:target,to:target});
 const stale=m.execute(out.state,'agent','mail.send',{id:draft.result.id,request_id:'stale-send',expected_version:m.version(s)});
 assert.equal(stale.result.status,'stale_version');assert.deepEqual(stale.state.data,s.data);
 const reset=m.execute(out.state,'infra','env.reset',{expected_version:m.version(out.state)});
 assert.equal(reset.state.virtual_now,initial.initial_virtual_now);assert.deepEqual(reset.state.data,initial.initial_data);
});

test('clock target is a strict offset-aware instant; equal instants do not invalidate observations',()=>{
 const m=createRuntime(),s=m.create('mail');
 const out=m.execute(s,'infra','env.advance_time',request(m,s));
 const equal=m.execute(out.state,'infra','env.advance_time',request(m,out.state,'equivalent','2026-11-20T20:00:00Z'));
 assert.equal(equal.result.status,'committed');assert.equal(equal.result.advanced,false);
 assert.equal(equal.state.virtual_now,target);assert.deepEqual(m.version(equal.state),m.version(out.state));
 const back=m.execute(equal.state,'infra','env.advance_time',request(m,equal.state,'back','2026-11-20T20:59:59+01:00'));
 assert.equal(back.result.status,'invalid_time');assert.deepEqual(stable(back.state),stable(equal.state));
 for(const invalid of ['bad','2026-02-30T00:00:00Z','2026-11-20T12:00:00','2026-11-20']){
  const bad=m.execute(s,'infra','env.advance_time',request(m,s,'bad',invalid));
  assert.equal(bad.result.status,'invalid_arguments',invalid);assert.deepEqual(stable(bad.state),stable(s));
 }
});

test('clock advances require Infra, a nonblank request ID and the observed version',()=>{
 const m=createRuntime(),s=m.create('mail'),args=request(m,s);
 assert.ok(m.tools(s,'infra').includes('env.advance_time'));assert.ok(!m.tools(s,'agent').includes('env.advance_time'));
 for(const [role,params,status] of [
  ['agent',args,'permission_denied'],
  ['infra',{...args,expected_version:{epoch:s.epoch,revision:s.revision+1}},'stale_version'],
  ['infra',{...args,expected_version:{epoch:s.epoch+1,revision:s.revision}},'stale_version'],
  ['infra',{...args,request_id:' '},'invalid_arguments'],
  ['infra',{...args,run_id:'other'},'invalid_arguments']
 ]){const out=m.execute(s,role,'env.advance_time',params);assert.equal(out.result.status,status);assert.deepEqual(stable(out.state),stable(s));}
});

test('clock retries retain their first receipt even after later operations, with conflict protection',()=>{
 const m=createRuntime(),s=m.create('mail'),args=request(m,s);
 const first=m.execute(s,'infra','env.advance_time',args);
 const later=m.execute(first.state,'infra','env.advance_time',request(m,first.state,'later','2026-11-21T12:00:00-08:00'));
 const retry=m.execute(later.state,'infra','env.advance_time',args);
 assert.deepEqual(retry.result,{...first.result,duplicate:true});assert.deepEqual(retry.state,later.state);
 const conflict=m.execute(later.state,'infra','env.advance_time',{...args,virtual_now:'2026-11-22T12:00:00Z'});
 assert.equal(conflict.result.status,'idempotency_conflict');assert.deepEqual(stable(conflict.state),stable(later.state));
});

test('all seven existing App packages consume a platform clock without new declarations or schema',()=>{
 const m=createRuntime({registryFile:path.resolve(__dirname,'../../apps.registry.json')});
 assert.equal(m.configs.size,7);
 for(const app of m.configs.keys()){
  const s=m.create(app,'shared','sandbox'),peer=m.create(app,'other','sandbox'),args=request(m,s);
  const out=m.execute(s,'infra','env.advance_time',args);
  assert.equal(out.result.status,'committed',app);assert.equal(m.normalize(out.state).virtual_now,target,app);
  assert.deepEqual(out.state.data,s.data,app);assert.equal(peer.virtual_now,s.virtual_now);
  assert.equal(m.get(app).contribution.declaration.interfaces.find(i=>i.audience.includes('infra')).operations.length,6);
 }
});

test('event handlers observe event time, and failed event handling rolls the clock back',()=>{
 const m=createRuntime(),s=m.create('mail'),pkg=m.get('mail'),handler=pkg.plugin.applyEvent;
 const event=structuredClone(require('../../examples/apps/mail/examples/scenario.json'));event.at=target;
 let observed;
 try{
  pkg.plugin.applyEvent=(ctx,data,e)=>{observed=ctx.virtual_now;return handler(ctx,data,e);};
  const out=m.execute(s,'infra','env.apply_event',{expected_version:m.version(s),event});
  assert.equal(out.result.status,'committed');assert.equal(observed,event.at);
  assert.equal(out.result.trace.virtual_received_at,s.virtual_now);assert.equal(out.result.trace.applied_at,event.at);
  for(const badHandler of [()=>{throw Error('fixture handler failure');},()=>({invalid:true})]){
   pkg.plugin.applyEvent=(ctx,data,e)=>{observed=ctx.virtual_now;return badHandler(ctx,data,e);};
   const failed=m.execute(s,'infra','env.apply_event',{expected_version:m.version(s),event});
   assert.equal(observed,event.at);assert.equal(failed.result.applied,false);assert.equal(failed.result.trace.applied_at,null);
   assert.deepEqual(stable(failed.state),stable(s));
  }
 }finally{pkg.plugin.applyEvent=handler;}
});

test('due events must be applied before a later clock barrier; advancement never manufactures an event',()=>{
 const m=createRuntime(),s=m.create('mail'),event=structuredClone(require('../../examples/apps/mail/examples/scenario.json'));
 const advanced=m.execute(s,'infra','env.advance_time',request(m,s));
 const late=m.execute(advanced.state,'infra','env.apply_event',{expected_version:m.version(advanced.state),event});
 assert.equal(late.result.status,'invalid_event');assert.deepEqual(late.state.data,s.data);
 const applied=m.execute(s,'infra','env.apply_event',{expected_version:m.version(s),event});
 assert.equal(applied.result.status,'committed');
 const ready=m.execute(applied.state,'infra','env.advance_time',request(m,applied.state));
 assert.equal(ready.result.status,'committed');assert.deepEqual(ready.state.data,applied.state.data);
 assert.deepEqual(ready.state.receipts['event:'+event.event_id],applied.state.receipts['event:'+event.event_id]);
});
