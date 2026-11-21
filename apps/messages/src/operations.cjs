'use strict';
const c = require('./common.cjs');
function conversation(data,id) {
  const value=data.conversations.find(x=>x.id===id);
  if(!value) c.fail('not_found','Conversation does not exist.');
  if(value.archived) c.fail('invalid_state','Conversation is archived.');
  return value;
}
function own(data,id) {
  const item=c.active(c.find(data,id));
  if(item.delivery_source || item.author_person_id!==data.owner_person_id) c.fail('permission_denied','Only locally authored messages may be edited, retracted or sent through this adapter.');
  return item;
}
function handleTool(ctx,data,name,args) {
  const read=c.read(ctx,data,name,args);
  if(read) return {data,result:read};
  const attached=c.attachment(ctx,data,name,args);
  if(attached) return {data,result:attached};
  let item;
  if(name==='messages.conversations') return {data,result:{conversations:c.copy(data.conversations)}};
  if(name==='messages.conversation.create') {
    const id=c.nextId(data,'conversation');
    data.conversations.push({id,title:args.title,participant_ids:c.copy(args.participant_ids),archived:false});
    c.log(ctx,'messages.conversation_created',{conversation_id:id});
    return {data,result:{id}};
  } else if(name==='messages.send') {
    conversation(data,args.conversation_id);
    item=c.create(ctx,data,{conversation_id:args.conversation_id,author_person_id:data.owner_person_id,
      text:args.text,sent_at:ctx.virtual_now,received_at:ctx.virtual_now,read_by:[data.owner_person_id],
      retracted:false,attachments:[],edits:[]});
    if(args.files?.length) {
      if(!ctx.assets?.add) c.fail('unsupported_capability','Sending attachments needs an asset writer.');
      item.attachments=ctx.assets.add({object_type:'message',object_id:item.id,files:args.files});
    }
  } else if(name==='messages.edit') {
    item=own(data,args.id);conversation(data,item.conversation_id);
    item.edits.push({at:item.updated_at,text:item.text});item.text=args.text;c.stamp(ctx,item,'edited');
  } else if(name==='messages.retract') {
    item=own(data,args.id);item.retracted=true;c.stamp(ctx,item,'retracted');
  } else if(name==='messages.mark_read') {
    item=c.find(data,args.id);
    if(!item.read_by.includes(data.owner_person_id)) item.read_by.push(data.owner_person_id);
    c.stamp(ctx,item,'marked_read');
  } else if(name==='messages.outbound') {
    item=own(data,args.id);
    return {data,result:{message:require('./messaging.cjs').outbound(ctx,data,item,args)}};
  } else c.fail('unknown_tool','Unknown Messages operation.');
  return {data,result:{id:item.id}};
}
module.exports={handleTool};
