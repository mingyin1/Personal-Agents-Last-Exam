'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const plugin = require('../plugin.cjs');
const {fixture} = require('./harness.cjs');
const app = require('../app.json').app_id;
const blob = (value='Synthetic content\n', filename='sample.txt') => ({filename,mime_type:'text/plain',
  base64:Buffer.from(value).toString('base64'),sha256:crypto.createHash('sha256').update(value).digest('hex')});
function unchanged(f,fn,pattern) {const before=f.data;assert.throws(fn,pattern);assert.deepEqual(f.data,before);}
test('standalone seed, list, get and search are side-effect free', () => {
  const f=fixture(),before=f.data,id=before[app][0].id;
  assert.equal(f.call(app+'.get',{id}).item.id,id);
  assert.equal(f.call(app+'.list',{query:id}).items.length,1);
  assert.equal(f.call(app+'.list',{query:'not-a-real-record'}).items.length,0);
  assert.deepEqual(f.data,before);
});
test('unknown IDs, fields and malformed history do not change data',()=>{
  const f=fixture();
  unchanged(f,()=>f.call(app+'.get',{id:'missing'}),/exist/);
  unchanged(f,()=>f.call(app+'.list',{role:'infra'}),/Input schema/);
  const bad=structuredClone(f.data);bad[app][0].account_id='other';
  assert.throws(()=>plugin.validateSeed(f.ctx,bad),/account/);
  bad[app][0].account_id=bad.account_id;bad[app][0].history[0].at='2099-01-01T00:00:00Z';
  assert.throws(()=>plugin.validateSeed(f.ctx,bad),/history/);
});
test('scenario updates preserve history; attempted replacement cannot erase it',()=>{
  const f=fixture(),event=structuredClone(require('../examples/scenario.json'));
  const original=f.data[app][0];
  f.event(event);assert.equal(f.data[app][0].updated_at,event.at);
  if(app==='notes') assert.equal(f.data.notes[0].revisions[0].body,original.body);
  if(app==='messages') assert.equal(f.data.messages[0].edits[0].text,original.text);
  const bad=structuredClone(event);bad.event_id='replacement';bad.payload.history=[];
  unchanged(f,()=>f.event(bad),/history/);
  bad.payload.history=event.payload.history;bad.payload.updated_at='invalid';
  unchanged(f,()=>f.event(bad),/Event schema/);
});
test('optional diagnostics cannot change business results',()=>{
  const on=fixture(),off=fixture({logging:false});
  const scenario=require('../examples/scenario.json');
  on.event(scenario);off.event(scenario);assert.deepEqual(on.data,off.data);
  assert.ok(on.logs.length);assert.equal(off.logs.length,0);
  const broken=fixture();broken.ctx.log=()=>{throw Error('logger offline');};
  broken.event(scenario);assert.deepEqual(broken.data,off.data);
});
test('reviewer renderer escapes untrusted content',()=>{
  const view=require('../gui/src/view.js');
  const html=view.render([{id:'test',title:'<img src=x onerror=alert(1)>',text:'<script>bad</script>'}]);
  assert.ok(!html.includes('<img'));assert.ok(!html.includes('<script>'));assert.ok(html.includes('&lt;'));
});

test('reads do not mark messages read; edits/retractions require the author',()=>{
  const f=fixture(),before=f.call('messages.get',{id:'msg-dinner'}).item;
  assert.ok(!before.read_by.includes('person-maya'));
  f.call('messages.mark_read',{id:'msg-dinner'});
  assert.ok(f.call('messages.get',{id:'msg-dinner'}).item.read_by.includes('person-maya'));
  unchanged(f,()=>f.call('messages.edit',{id:'msg-dinner',text:'Forged'}),/author/);
  unchanged(f,()=>f.call('messages.retract',{id:'msg-dinner'}),/author/);
  const id=f.call('messages.send',{conversation_id:'conversation-home',text:'I will check.'}).id;
  f.call('messages.edit',{id,text:'Pantry checked.'});
  assert.equal(f.call('messages.get',{id}).item.edits[0].text,'I will check.');
  f.call('messages.retract',{id});
  unchanged(f,()=>f.call('messages.edit',{id,text:'Silently reopen'}),/Restore/);
});
test('conversations require bound participants and membership of the account owner',()=>{
  const f=fixture();
  unchanged(f,()=>f.call('messages.conversation.create',{title:'Secret',participant_ids:['person-alex']}),/owner/);
  unchanged(f,()=>f.call('messages.conversation.create',{title:'Unknown',participant_ids:['person-maya','unknown']}),/binding/);
  unchanged(f,()=>f.call('messages.send',{conversation_id:'missing',text:'Hi'}),/exist/);
  unchanged(f,()=>f.call('messages.send',{conversation_id:'conversation-home',text:''}),/empty/);
});
test('outbound contract carries original bytes, stable event ID/time, and explicit destination',()=>{
  const f=fixture(),id=f.call('messages.send',{conversation_id:'conversation-home',text:'Receipt',files:[blob()]}).id;
  const args={id,recipient_account_id:'messages-alex',conversation_id:'conversation-home'};
  const first=f.call('messages.outbound',args).message;
  assert.equal(first.data.content.attachments[0].sha256,blob().sha256);
  f.ctx.virtual_now='2026-11-18T10:00:00-08:00';
  assert.deepEqual(f.call('messages.outbound',args).message,first);
  assert.equal(first.data.channel,'channel.chat');
});

test('marking an outgoing message read does not create a new delivery identity',()=>{
  const f=fixture(),id=f.call('messages.send',{conversation_id:'conversation-home',text:'A stable message.'}).id;
  const args={id,recipient_account_id:'messages-alex',conversation_id:'conversation-home'};
  const before=f.call('messages.outbound',args).message;
  f.ctx.virtual_now='2026-11-18T10:00:00-08:00';
  f.call('messages.mark_read',{id});
  assert.deepEqual(f.call('messages.outbound',args).message,before);
  f.call('messages.edit',{id,text:'A different version.'});
  assert.notEqual(f.call('messages.outbound',args).message.id,before.id);
  f.call('messages.edit',{id,text:'A stable message.'});
  assert.notEqual(f.call('messages.outbound',args).message.id,before.id);
});

test('a received App notification is not an own authored message even when its account owner matches',()=>{
  const f=fixture();
  f.ctx.binding.accounts.push({app_id:'orders',account_id:'orders-maya',owner_person_id:'person-maya'});
  const message={specversion:'1.0',id:'order-notice',source:'urn:pale:app:orders:account:orders-maya',
    type:'org.pale.messages.chat.v1',time:f.ctx.virtual_now,datacontenttype:'application/json',
    dataschema:'urn:pale:messages:chat-payload:1',data:{channel:'channel.chat',
      recipient:{kind:'app_account_ref',app_id:'messages',id:'messages-maya'},
      source_object:{app_id:'orders',account_id:'orders-maya',object_type:'order',object_id:'order-1'},
      content:{conversation_id:'conversation-home',text:'Order confirmed.',attachments:[]},extensions:[]}};
  f.event({event_id:'delivered-order',at:f.ctx.virtual_now,operation:'messages.receive',
    payload:{recipient_account_id:'messages-maya',message}});
  unchanged(f,()=>f.call('messages.edit',{id:'delivered-order',text:'Forged confirmation'}),/author|received/);
  unchanged(f,()=>f.call('messages.retract',{id:'delivered-order'}),/author|received/);
  unchanged(f,()=>f.call('messages.attachment.add',{id:'delivered-order',files:[blob()]}),/author|received/);
  const forged=f.call('messages.get',{id:'delivered-order'}).item;
  delete forged.delivery_source;
  forged.updated_at='2026-11-18T10:00:00-08:00';forged.history.push({at:forged.updated_at,action:'strip_source'});
  unchanged(f,()=>f.event({event_id:'strip-source',at:forged.updated_at,operation:'messages.upsert',payload:forged}),/immutable/);
});
