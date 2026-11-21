'use strict';
const {person,fail} = require('./common.cjs');
function validate(ctx,data) {
  const conversations=new Map(data.conversations.map(c=>[c.id,c]));
  if(conversations.size!==data.conversations.length) fail('invalid_seed','Duplicate conversation ID.');
  for(const conversation of conversations.values()) {
    if(!conversation.title.trim() || !conversation.participant_ids.includes(data.owner_person_id)) {
      fail('invalid_seed','A conversation must include this account owner.');
    }
    conversation.participant_ids.forEach(id=>person(ctx,id));
    if(data.messages.some(m=>m.id===conversation.id)) fail('invalid_seed','Message and conversation IDs must differ.');
  }
  for(const message of data.messages) {
    if(message.delivery_source) {
      const source=message.delivery_source;
      const account=ctx.binding.accounts.find(a=>a.app_id===source.app_id && a.account_id===source.account_id);
      if(!account || account.owner_person_id!==message.author_person_id) fail('invalid_seed','Delivery source must match its bound owner.');
    }
    const conversation=conversations.get(message.conversation_id);
    if(!conversation || !conversation.participant_ids.includes(message.author_person_id) ||
       message.read_by.some(id=>!conversation.participant_ids.includes(id))) fail('invalid_seed','Message references a nonparticipant.');
    if(!message.text.trim() && !message.attachments.length && !message.retracted) fail('invalid_seed','An empty message needs an attachment.');
    if(message.edits.some(e=>Date.parse(e.at)>Date.parse(message.updated_at))) fail('invalid_seed','Edit timestamp exceeds last update.');
  }
}
module.exports={validate};
