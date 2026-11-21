'use strict';
// A small Infra caller example, not a scheduler. All state is disposable.
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {Client}=require('../../../runtime/client.cjs');
const {create:router}=require('../../../runtime/messaging/src/router.cjs');
const root=path.resolve(__dirname,'../../..');
async function run(){
 const stateDir=fs.mkdtempSync(path.join(os.tmpdir(),'pale-session-clock-')),runId='session-clock',clients=[],receipts=[];
 let checks=0;
 const eq=(a,b,label)=>{assert.deepEqual(a,b,label);checks++;};
 const open=async(app,role)=>{const c=new Client(app,role,runId,stateDir,'session-time-example');clients.push(c);await c.initialize();return c;};
 const snapshot=c=>c.call('env.snapshot');
 const session1='2026-10-26T19:40:00-07:00',session3='2026-10-29T12:00:00-07:00';
 try{
  const mail=await open('mail','infra'),calendar=await open('calendar','infra');
  for(const [app,c] of [['mail',mail],['calendar',calendar]]){
   const s=await snapshot(c);
   eq((await c.call('env.reset',{expected_version:s.version,profile:'sandbox'})).status,'ready');
   const current=await snapshot(c),data=structuredClone(current.snapshot.data);
   data[app==='mail'?'messages':'events']=[];
   eq((await c.call('env.load_seed',{expected_version:current.version,request_id:'baseline',data,virtual_now:session1})).status,'ready');
   const tools=(await c.request('tools/list')).result.tools;
   eq(tools.some(t=>t.name==='env.advance_time'),true,'Discover the host capability before running a multi-session task');
  }
  const agent=await open('mail','agent'),calAgent=await open('calendar','agent');
  eq((await agent.call('mail.search')).status,'ok');
  eq((await snapshot(mail)).snapshot.virtual_now,session1,'Agent reads do not advance virtual time');
  eq((await agent.call('env.advance_time',{request_id:'forged',virtual_now:session3,expected_version:(await snapshot(mail)).version})).status,'permission_denied');

  // The caller processes due scenario events before advancing to session 3.
  // There are deliberately NO incoming Mail events between the sessions.
  const event=structuredClone(require('../../apps/calendar/examples/scenario.json'));
  event.event_id='due-calendar-event';event.at='2026-10-27T09:05:00-07:00';
  event.payload.start='2026-10-30T10:00:00-07:00';event.payload.end='2026-10-30T11:00:00-07:00';
  const applied=await calendar.call('env.apply_event',{expected_version:(await snapshot(calendar)).version,event});
  eq(applied.status,'committed');
  const before={mail:await snapshot(mail),calendar:await snapshot(calendar)};
  const args={};
  // An actual orchestrator must pause actors/deliveries, drain due events, and
  // keep the next session paused if ANY App fails this barrier.
  for(const [app,c] of [['mail',mail],['calendar',calendar]]){
   args[app]={request_id:'session-3',expected_version:before[app].version,virtual_now:session3};
   const receipt=await c.call('env.advance_time',args[app]);receipts.push({app,...receipt});
   eq(receipt.status,'committed');
   const current=await snapshot(c);
   eq(current.snapshot.virtual_now,session3);eq(current.snapshot.data,before[app].snapshot.data,'Clock changes do not rewrite records');
   eq(current.version.epoch,before[app].version.epoch,'Clock changes preserve the lifecycle binding');
  }
  const draft=await agent.call('mail.draft.create',{to:['billing@example.com'],subject:'Billing follow-up',body:'Synthetic session 3 reply.',request_id:'draft',expected_version:(await snapshot(mail)).version});
  eq(draft.status,'committed');
  const sent=await agent.call('mail.send',{id:draft.id,request_id:'send',expected_version:draft.version});
  eq(sent.status,'committed');
  const message=(await agent.call('mail.get',{id:draft.id})).message;
  eq(message.sent_at,session3,'Mail uses the new session time without incoming mail');
  eq((await snapshot(mail)).snapshot.virtual_now,session3,'Agent writes do not advance time');
  const ics=await calAgent.call('calendar.export_ics',{id:event.payload.id});
  eq(ics.status,'ok');eq(ics.text.includes('DTSTAMP:20261029T190000Z'),true,'Calendar uses the same logical instant');

  // A Router already bound to the receiver remains valid across clock changes.
  const bridge=await router({publisher:'delivery',run:runId,stateDir});clients.push(bridge);
  const deliveryTime='2026-10-29T12:05:00-07:00';
  for(const c of [mail,calendar]){
   const observed=await snapshot(c);
   eq((await c.call('env.advance_time',{request_id:'delivery-boundary',expected_version:observed.version,virtual_now:deliveryTime})).status,'committed');
   eq((await snapshot(c)).snapshot.virtual_now,deliveryTime);
  }
  const notification=structuredClone(require('../delivery-to-mail/delivery/message.json'));
  notification.id='session-time-notice';notification.time='2026-10-26T19:00:00-07:00';
  const delivered=await bridge.call('router.publish',{request_id:'notice',message:notification});
  eq(delivered.status,'committed');eq(delivered.applied_at,deliveryTime);eq(delivered.cloud_event.time,notification.time);
  const after=await snapshot(mail),incoming=after.snapshot.data.messages.find(m=>m.id===delivered.event_id);
  eq(incoming.received_at,deliveryTime,'Mail receives at its synchronized clock, preserving producer time separately');
  eq(after.snapshot.virtual_now,deliveryTime,'The old producer time cannot roll back the receiver clock');
  eq(delivered.receiver_trace.virtual_received_at,deliveryTime);eq(delivered.receiver_trace.applied_at,deliveryTime);
  eq((await bridge.call('router.publish',{request_id:'notice-retry',message:notification})).duplicate,true);
  const clockAudit=after.snapshot.audit.find(row=>row.tool==='env.advance_time'&&row.clock?.request_id==='session-3');
  eq(clockAudit.clock.to,message.sent_at,'Clock receipt/audit joins to the later business timestamp');
  await mail.close();
  const restarted=await open('mail','infra'),persisted=await snapshot(restarted);
  eq(persisted.snapshot.virtual_now,deliveryTime,'Time survives an MCP restart');
  const replay=await restarted.call('env.advance_time',args.mail);
  eq(replay.duplicate,true);eq(replay.virtual_now,session3,'A replay returns its original acknowledgement, not the current clock');
  eq((await snapshot(restarted)).snapshot.virtual_now,deliveryTime,'A replay never rewinds state');

  // Two management clients observed the same version. Only one may advance it.
  const second=await open('mail','infra'),version=(await snapshot(restarted)).version;
  const raced=await Promise.all([restarted.call('env.advance_time',{expected_version:version,request_id:'race-a',virtual_now:'2026-10-29T12:10:00-07:00'}),second.call('env.advance_time',{expected_version:version,request_id:'race-b',virtual_now:'2026-10-29T12:15:00-07:00'})]);
  eq(raced.map(r=>r.status).sort(),['committed','stale_version']);
  const latest=await snapshot(restarted);
  eq((await restarted.call('env.reset',{expected_version:latest.version})).status,'ready');
  eq((await snapshot(restarted)).snapshot.virtual_now,session1,'Reset still restores the task baseline');
  return {passed:true,checks,runtime_version:require('../../../runtime/package.json').version,node:process.version,session1,session3,clock_receipts:receipts,sent_at:message.sent_at,clock_audit:clockAudit,delivery:delivered};
 }finally{await Promise.allSettled(clients.map(c=>c.close()));fs.rmSync(stateDir,{recursive:true,force:true});}
}
module.exports={run};
if(require.main===module)run().then(report=>{if(process.argv[2])fs.writeFileSync(path.resolve(process.argv[2]),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));}).catch(e=>{console.error(e);process.exitCode=1;});
