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

test('notes preserve content revisions, tags and explicit archive/trash behavior',()=>{
  const f=fixture(),id=f.call('notes.create',{title:'Shopping',body:'Oats',tags:['food']}).id;
  f.call('notes.update',{id,patch:{body:'Oats and tea'}});
  const n=f.call('notes.get',{id}).item;
  assert.equal(n.body,'Oats and tea');assert.equal(n.revisions[0].body,'Oats');
  f.call('notes.flags',{id,patch:{archived:true}});
  assert.equal(f.call('notes.list',{query:id}).items.length,0);
  unchanged(f,()=>f.call('notes.update',{id,patch:{body:'lost'}}),/Restore/);
  f.call('notes.flags',{id,patch:{archived:false,trashed:false}});
  unchanged(f,()=>f.call('notes.update',{id,patch:{}}),/Patch/);
  unchanged(f,()=>f.call('notes.update',{id,patch:{title:'  '}}),/blank/);
});
test('note attachment bytes are tied to their parent',()=>{
  const f=fixture(),id=f.call('notes.create',{title:'Receipt'}).id;
  f.call('notes.attachment.add',{id,files:[blob()]});
  const asset_id=f.call('notes.get',{id}).item.attachments[0];
  assert.equal(f.call('notes.attachment.read',{id,asset_id}).file.base64,blob().base64);
  unchanged(f,()=>f.call('notes.attachment.read',{id:'note-groceries',asset_id}),/another record/);
  unchanged(f,()=>f.call('notes.attachment.add',{id,files:[{...blob(),sha256:'0'.repeat(64)}]}),/hash/);
});
