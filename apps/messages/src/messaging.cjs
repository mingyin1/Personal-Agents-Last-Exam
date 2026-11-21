'use strict';
const {fail,log} = require('./common.cjs');
const crypto = require('node:crypto');
function outbound(ctx,data,item,args) {
  const content={conversation_id:args.conversation_id,text:item.text,
    attachments:item.attachments.map(id=>ctx.assets.read(id))};
  const payload={channel:'channel.chat',recipient:{kind:'app_account_ref',app_id:'messages',id:args.recipient_account_id},
    source_object:{app_id:'messages',account_id:data.account_id,object_type:'message',object_id:item.id},content,extensions:[]};
  // Stable retries; changed content/destination produces a new event identity.
  const id='chat-'+crypto.createHash('sha256').update(JSON.stringify([item.id,item.edits.length,payload])).digest('hex').slice(0,40);
  return {specversion:'1.0',id,source:'urn:pale:app:messages:account:'+encodeURIComponent(data.account_id),
    type:'org.pale.messages.chat.v1',...(item.sent_at===null?{}:{time:item.sent_at}),datacontenttype:'application/json',
    dataschema:'urn:pale:messages:chat-payload:1',data:payload};
}
function receive(ctx,data,event) {
  const {recipient_account_id,message}=event.payload;
  if(recipient_account_id!==data.account_id) fail('invalid_event','Wrong receiving account.');
  const source=message.data.source_object;
  const account=ctx.binding.accounts.find(a=>a.app_id===source.app_id && a.account_id===source.account_id);
  const conversation=data.conversations.find(c=>c.id===message.data.content.conversation_id);
  if(!account || !conversation || conversation.archived || !conversation.participant_ids.includes(account.owner_person_id)) {
    fail('permission_denied','Bound sender must participate in the destination conversation.');
  }
  if(data.messages.some(m=>m.id===event.event_id)) fail('already_exists','Delivered record already exists.');
  const record={id:event.event_id,account_id:data.account_id,created_at:event.at,updated_at:event.at,
    history:[{at:event.at,action:'received'}],conversation_id:conversation.id,author_person_id:account.owner_person_id,
    text:message.data.content.text,sent_at:message.time || null,received_at:event.at,
    read_by:[],retracted:false,attachments:[],edits:[],delivery_source:structuredClone(source)};
  if(message.data.content.attachments.length) {
    if(!ctx.assets?.add) fail('unsupported_capability','Receiving attachments requires an asset writer.');
    record.attachments=ctx.assets.add({object_type:'message',object_id:record.id,files:message.data.content.attachments});
  }
  data.messages.push(record);
  log(ctx,'messages.delivery_prepared',{record_id:record.id});
  return data;
}
module.exports={outbound,receive};
