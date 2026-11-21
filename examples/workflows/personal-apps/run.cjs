'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {Client} = require('../../../runtime/client.cjs');
const root = path.resolve(__dirname, '../../..');
const registry = path.join(root, 'apps.registry.json');
const apps = ['files','messages','notes','tasks','contacts'];
const copy = value => structuredClone(value);

async function run() {
  const state = fs.mkdtempSync(path.join(os.tmpdir(), 'pale-personal-apps-'));
  const clients = [], checks = [];
  let sequence = 0;
  const equal = (label, actual, expected) => {assert.deepEqual(actual, expected, label);checks.push(label);};
  const ok = (label, condition) => {assert.ok(condition, label);checks.push(label);};
  async function open(app, role, run='business', directory=state) {
    const client = new Client(app,role,run,directory,'personal-apps-workflow',{registry});
    clients.push(client); await client.initialize(); return client;
  }
  async function sandbox(infra) {
    const snapshot = await infra.call('env.snapshot');
    const result = await infra.call('env.reset',{expected_version:snapshot.version,profile:'sandbox'});
    assert.equal(result.status,'ready');
  }
  async function write(agent, infra, name, args) {
    const result = await agent.call(name,{...args,expected_version:(await infra.call('env.snapshot')).version,request_id:'write-'+(++sequence)});
    assert.equal(result.status,'committed',JSON.stringify({name,result}));return result;
  }
  async function bind(infra, more, transform=data=>data) {
    const s=await infra.call('env.snapshot');
    const binding=copy(s.snapshot.binding);binding.accounts.push(...more);
    const data=transform(copy(s.snapshot.data)),bundle=copy(s.snapshot.resources.bundle);
    bundle.dataset.expected_counts.records=data[s.snapshot.app_id].length;
    const result=await infra.call('env.load_seed',{expected_version:s.version,request_id:'bind-'+(++sequence),
      data,binding,policies:copy(s.snapshot.policies),bundle});
    assert.equal(result.status,'ready',JSON.stringify(result));
  }
  async function router(run='notifications', config=path.join(__dirname,'notification-config.json'), publisher='order-notifier') {
    const client=new Client(null,null,null,null,'personal-apps-router',{commandArgs:[path.join(root,'runtime/messaging/service.cjs'),
      '--config',config,'--publisher',publisher,'--run',run,'--state-dir',state]});
    clients.push(client);await client.initialize();return client;
  }
  const orderBinding={app_id:'order-notifier',account_id:'order-maya',owner_person_id:'person-maya'};
  function notification(id,file) {
    return {specversion:'1.0',id,source:'urn:pale:app:order-notifier:account:order-maya',type:'org.pale.messages.chat.v1',
      time:'2026-11-18T08:59:00-08:00',datacontenttype:'application/json',dataschema:'urn:pale:messages:chat-payload:1',
      data:{channel:'channel.chat',recipient:{kind:'app_account_ref',app_id:'messages',id:'messages-maya'},
        source_object:{app_id:'order-notifier',account_id:'order-maya',object_type:'order',object_id:'order-1'},
        content:{conversation_id:'conversation-home',text:'Order receipt is ready.',attachments:[file]},extensions:[]}};
  }
  try {
    const agents={},infra={};
    for(const app of apps) {
      agents[app]=await open(app,'agent');infra[app]=await open(app,'infra');
      const testCase=require(path.join(root,'apps',app,'tests/cases.json'));
      const initial=await infra[app].call('env.snapshot');
      equal(app+': scenario rejects writes',(await agents[app].call(testCase.write.name,{...testCase.write.args,
        expected_version:initial.version,request_id:'denied'})).status,'permission_denied');
      await sandbox(infra[app]);
      const before=await infra[app].call('env.snapshot');
      const args={...testCase.write.args,expected_version:before.version,request_id:'first-write'};
      const committed=await agents[app].call(testCase.write.name,args);
      equal(app+': write commits',committed.status,'committed');
      const retry=await agents[app].call(testCase.write.name,args);
      ok(app+': identical retry returns first receipt',retry.duplicate && retry.id===committed.id);
      equal(app+': stale version rejected',(await agents[app].call(testCase.write.name,{...args,request_id:'stale'})).status,'stale_version');
      const changed={...args,...(app==='messages'?{text:'changed'}:app==='files'?{name:'changed'}:app==='contacts'?{display_name:'changed'}:{title:'changed'})};
      equal(app+': changed retry rejected',(await agents[app].call(testCase.write.name,changed)).status,'idempotency_conflict');
      const after=await infra[app].call('env.snapshot');
      equal(app+': exactly one revision',after.version.revision,before.version.revision+1);
      ok(app+': committed data actually contains new record',after.snapshot.data[app].some(r=>r.id===committed.id));
      const peer=await open(app,'infra','separate-run');
      equal(app+': separate run unchanged',(await peer.call('env.snapshot')).snapshot.data,initial.snapshot.data);
      await agents[app].close();agents[app]=await open(app,'agent');
      equal(app+': new process sees durable record',(await agents[app].call(app+'.get',{id:committed.id})).item.id,committed.id);
    }

    const contact=(await agents.contacts.call('contacts.get',{id:'contact-alex'})).item;
    const task=await write(agents.tasks,infra.tasks,'tasks.create',{title:'Review receipt',assignee_person_id:contact.person_id});
    equal('Contacts person ID reaches Tasks',(await agents.tasks.call('tasks.get',{id:task.id})).item.assignee_person_id,'person-alex');
    await write(agents.tasks,infra.tasks,'tasks.transition',{id:task.id,status:'completed'});
    await write(agents.tasks,infra.tasks,'tasks.transition',{id:task.id,status:'todo'});
    equal('Reopen removes current completion time',(await agents.tasks.call('tasks.get',{id:task.id})).item.completed_at,null);

    const file=(await agents.files.call('files.read',{id:'file-receipt'})).file;
    ok('Files returns actual synthetic receipt bytes',Buffer.from(file.base64,'base64').toString().includes('USD 24.50'));
    const mailAgent=await open('mail','agent'),mailInfra=await open('mail','infra');await sandbox(mailInfra);
    const draft=await write(mailAgent,mailInfra,'mail.draft.create',{to:['alex@example.test'],subject:'Receipt for review',body:'Attached original receipt.'});
    await write(mailAgent,mailInfra,'mail.attachment.add',{id:draft.id,files:[file]});
    const mail=(await mailAgent.call('mail.get',{id:draft.id})).message;
    const received=(await mailAgent.call('mail.attachment.get',{id:draft.id,asset_id:mail.attachments[0]})).file;
    equal('Files → Mail preserves original bytes and hash',[received.base64,received.sha256],[file.base64,file.sha256]);
    const note=await write(agents.notes,infra.notes,'notes.create',{title:'Receipt evidence',body:'Original attachment from Mail.'});
    await write(agents.notes,infra.notes,'notes.attachment.add',{id:note.id,files:[received]});
    const noteRecord=(await agents.notes.call('notes.get',{id:note.id})).item;
    equal('Mail → Notes stores readable destination bytes',(await agents.notes.call('notes.attachment.read',{id:note.id,asset_id:noteRecord.attachments[0]})).file.sha256,file.sha256);

    const deniedSnapshot=await infra.notes.call('env.snapshot');
    const restricted=copy(deniedSnapshot.snapshot.policies);
    restricted.sandbox.constraints['notes.get']={ids:['note-groceries']};
    const restrictedBundle=copy(deniedSnapshot.snapshot.resources.bundle);
    restrictedBundle.dataset.expected_counts.records=deniedSnapshot.snapshot.data.notes.length;
    const reloaded=await infra.notes.call('env.load_seed',{expected_version:deniedSnapshot.version,request_id:'restrict-note',data:deniedSnapshot.snapshot.data,
      binding:deniedSnapshot.snapshot.binding,policies:restricted,bundle:restrictedBundle});
    assert.equal(reloaded.status,'ready',JSON.stringify(reloaded));checks.push('Restricted policy loads');
    equal('Attachment cannot bypass parent authorization',(await agents.notes.call('notes.attachment.read',{id:note.id,asset_id:noteRecord.attachments[0]})).status,'not_available');
    const raw=await agents.notes.request('resources/read',{uri:'pale://business/notes/assets/'+noteRecord.attachments[0]});
    ok('Raw resource API also denies restricted attachment',!!raw.error);
    const rejectedBefore=await infra.files.call('env.snapshot');
    const corrupt=await agents.files.call('files.put',{id:'file-receipt',file:{...file,sha256:'0'.repeat(64)},
      expected_version:rejectedBefore.version,request_id:'bad-hash'});
    equal('Real Core rejects corrupt attachment',corrupt.status,'invalid_attachment');
    const rejectedAfter=await infra.files.call('env.snapshot');
    equal('Rejected import preserves data and bytes',[rejectedAfter.snapshot.data,rejectedAfter.snapshot.resources],
      [rejectedBefore.snapshot.data,rejectedBefore.snapshot.resources]);

    equal('Publisher copy matches receiver-owned wire schema',require('./publisher/schemas/router-message.schema.json'),require('../../../apps/messages/schemas/router-message.schema.json'));
    const receiverInfra=await open('messages','infra','notifications');await bind(receiverInfra,[orderBinding]);await sandbox(receiverInfra);
    const receiverAgent=await open('messages','agent','notifications');const bridge=await router();
    const message=notification('order-notice-1',file);
    const receipt=await bridge.call('router.publish',{request_id:'order-1',message});
    equal('Independent publisher → Messages commits',receipt.status,'committed');
    const delivered=(await receiverAgent.call('messages.get',{id:receipt.event_id})).item;
    equal('Receiver stores original sender time',delivered.sent_at,message.time);
    equal('Receiving does not mark a notification read',delivered.read_by,[]);
    equal('Received provenance identifies the publishing App',delivered.delivery_source,message.data.source_object);
    const tamper=await receiverAgent.call('messages.edit',{id:delivered.id,text:'Forged order confirmation',
      expected_version:(await receiverInfra.call('env.snapshot')).version,request_id:'edit-received'});
    equal('Account ownership does not grant edit rights over a received notification',tamper.status,'permission_denied');
    equal('Rejected receiver edit preserves the message',(await receiverAgent.call('messages.get',{id:delivered.id})).item,delivered);
    equal('Receiver attachment bytes are readable',(await receiverAgent.call('messages.attachment.read',{id:delivered.id,asset_id:delivered.attachments[0]})).file.base64,file.base64);
    ok('Receipt connects producer, receiver and commit time',receipt.cloud_event.time===message.time && receipt.receiver_trace.cloud_event.id===message.id && !!receipt.committed_at);
    ok('Repeated notification deduplicates',(await bridge.call('router.publish',{request_id:'order-retry',message})).duplicate);
    const conflict=copy(message);conflict.data.content.text='Changed';
    equal('Changed notification ID reuse rejected',(await bridge.call('router.publish',{request_id:'order-change',message:conflict})).code,'idempotency_conflict');
    const noTime=notification('order-no-time',file);delete noTime.time;
    const noTimeReceipt=await bridge.call('router.publish',{request_id:'order-no-time',message:noTime});
    equal('Missing producer time still commits',noTimeReceipt.status,'committed');
    equal('Missing time is not fabricated',(await receiverAgent.call('messages.get',{id:noTimeReceipt.event_id})).item.sent_at,null);
    ok('Receipt still records receive and commit times',!!noTimeReceipt.received_at && !!noTimeReceipt.committed_at && !('time' in noTimeReceipt.cloud_event));
    const spoof=copy(message);spoof.id='spoof';spoof.source='urn:pale:app:other:account:other';
    equal('Source impersonation rejected',(await bridge.call('router.publish',{request_id:'spoof',message:spoof})).code,'source_identity_mismatch');
    const unknown=copy(message);unknown.id='unknown';unknown.data.recipient.id='missing-account';
    equal('Unknown recipient rejected',(await bridge.call('router.publish',{request_id:'unknown',message:unknown})).code,'recipient_unavailable');

    const noGrant=copy(require('./notification-config.json'));noGrant.publishers[0].allowed_recipients=[];
    const noGrantFile=path.join(state,'no-grant.json');fs.writeFileSync(noGrantFile,JSON.stringify(noGrant));
    const deniedBridge=await router('denied',noGrantFile);
    equal('Missing grant rejected',(await deniedBridge.call('router.publish',{request_id:'no-grant',message})).code,'recipient_not_authorized');
    const deniedInfra=await open('messages','infra','denied');
    equal('Denied delivery leaves initial records untouched',(await deniedInfra.call('env.snapshot')).snapshot.data.messages.length,1);
    const invalidInfra=await open('messages','infra','bad-conversation');await bind(invalidInfra,[orderBinding]);
    const invalidBridge=await router('bad-conversation');
    const invalid=notification('bad-conversation',file);invalid.data.content.conversation_id='missing';
    const invalidReceipt=await invalidBridge.call('router.publish',{request_id:'invalid',message:invalid});
    ok('Receiver rejects unbound conversation and requests inspection',invalidReceipt.code==='receiver_rejected' && invalidReceipt.stop_run);
    equal('Receiver refusal has no partial records',(await invalidInfra.call('env.snapshot')).snapshot.data.messages.length,1);

    // Two instances of the same package: source and destination have separate state roots.
    const sourceInfra=await open('messages','infra','two-accounts');
    await bind(sourceInfra,[{app_id:'messages',account_id:'messages-alex',owner_person_id:'person-alex'}],data=>{
      data.account_id='messages-alex';data.owner_person_id='person-alex';data.messages=[];return data;
    });
    await sandbox(sourceInfra);
    const sourceAgent=await open('messages','agent','two-accounts');
    const sourceMessage=await write(sourceAgent,sourceInfra,'messages.send',{conversation_id:'conversation-home',text:'Receipt from Alex.',files:[file]});
    const targetInfra=await open('messages','infra','two-accounts',path.join(state,'receiver'));
    await bind(targetInfra,[{app_id:'messages',account_id:'messages-alex',owner_person_id:'person-alex'}]);
    const outgoing=(await sourceAgent.call('messages.outbound',{id:sourceMessage.id,recipient_account_id:'messages-maya',conversation_id:'conversation-home'})).message;
    const accountBridge=await router('two-accounts',path.join(__dirname,'messages-config.json'),'messages');
    const accountReceipt=await accountBridge.call('router.publish',{request_id:'two-accounts',message:outgoing});
    equal('Messages A → Messages B commits',accountReceipt.status,'committed');
    const targetAgent=await open('messages','agent','two-accounts',path.join(state,'receiver'));
    const targetRecord=(await targetAgent.call('messages.get',{id:accountReceipt.event_id})).item;
    equal('Receiver resolves sender through account binding',targetRecord.author_person_id,'person-alex');
    equal('Receiver gets bytes from the source App',(await targetAgent.call('messages.attachment.read',{id:targetRecord.id,asset_id:targetRecord.attachments[0]})).file.sha256,file.sha256);
    equal('Source records remain in the source instance',(await sourceInfra.call('env.snapshot')).snapshot.data.messages.length,1);
    // Advance the source clock through an independent scripted incoming record.
    const sourceSnap=await sourceInfra.call('env.snapshot');
    const incoming=copy(sourceSnap.snapshot.data.messages[0]);
    incoming.id='clock-update';incoming.attachments=[];incoming.text='A later scripted message';
    incoming.created_at='2026-11-18T10:00:00-08:00';incoming.updated_at=incoming.created_at;
    incoming.history=[{at:incoming.created_at,action:'received'}];
    const advanced=await sourceInfra.call('env.apply_event',{expected_version:sourceSnap.version,
      event:{event_id:'advance-clock',at:incoming.updated_at,operation:'messages.upsert',payload:incoming}});
    equal('Source clock advances independently',advanced.status,'committed');
    await write(sourceAgent,sourceInfra,'messages.mark_read',{id:sourceMessage.id});
    const afterRead=(await sourceAgent.call('messages.outbound',{id:sourceMessage.id,recipient_account_id:'messages-maya',conversation_id:'conversation-home'})).message;
    equal('Read-status update preserves outbound identity and producer time',afterRead,outgoing);
    const replay=await accountBridge.call('router.publish',{request_id:'after-read-retry',message:afterRead});
    ok('Publish retry after a read-status change remains a duplicate',replay.duplicate && replay.event_id===accountReceipt.event_id);
    equal('Read-status retry creates no additional receiver record',(await targetInfra.call('env.snapshot')).snapshot.data.messages.length,2);
    return {passed:true,checks,receipt,account_receipt:accountReceipt};
  } finally {
    await Promise.allSettled(clients.map(client=>client.close()));
    fs.rmSync(state,{recursive:true,force:true});
  }
}
module.exports={run};
if(require.main===module) run().then(report=>console.log(JSON.stringify(report,null,2))).catch(error=>{console.error(error);process.exitCode=1;});
