import {mount,el,avatar,date,time,human,tag,textBlock,metadata,transfer} from '/shared/client.js';
// App-owned interaction catalog and presentation. The Host only supplies an Agent connection.
export const config={
 id:'messages',title:'Messages',description:'Follow conversations and manage your own messages.',
 list:'messages.list',collection:'items',queryField:'query',listArgs:{include_inactive:true},get:'messages.get',item:'item',
 heading:m=>m.text||'Retracted message',subtitle:m=>m.conversation_id+' · '+(m.retracted?'Retracted':m.author_person_id),
 labels:{text:'Message',conversation_id:'Conversation ID',participant_ids:'Participant person IDs',recipient_account_id:'Recipient account ID'},
 actions:[
  {label:'New message',tool:'messages.send',primary:true,success:'Message saved.'},
  {label:'New conversation',tool:'messages.conversation.create'},
  {label:'View conversations',tool:'messages.conversations'},
  {label:'Edit message',tool:'messages.edit',selected:true,prefill:m=>({text:m.text})},
  {label:'Mark read',tool:'messages.mark_read',selected:true},
  {label:'Retract',tool:'messages.retract',selected:true},
  {label:'Add attachments',tool:'messages.attachment.add',selected:true},
  {label:'Download attachment',tool:'messages.attachment.read',selected:true},
  {label:'Export delivery envelope',tool:'messages.outbound',selected:true,exportResult:'outbound-message.json'}
 ]
};


const unsent=new Map();
const conversation=(id,ui)=>ui.aux.conversations?.find(c=>c.id===id);
function thread(item,ui){
 const c=conversation(item?.conversation_id||ui.section,ui);
 if(!c)return el('div',{class:'empty'},'Choose a conversation.');
 const messages=ui.records.filter(m=>m.conversation_id===c.id).sort((a,b)=>Date.parse(a.sent_at)-Date.parse(b.sent_at));
 const bubbles=el('div',{class:'chat-messages'});
 for(const m of messages){
  const row=el('div',{class:'chat-entry'},avatar(human(m.author_person_id)),el('div',{class:'bubble-wrap'},el('div',{class:'bubble-meta'},el('strong',{},human(m.author_person_id)),el('time',{},time(m.sent_at))),ui.record(m,el('span',{class:'bubble-text'},m.retracted?'Message retracted':m.text)),m.edits.length?el('small',{class:'muted'},'Edited'):null,m.id===item?.id?ui.attachments(m,'messages.attachment.read'):null));
  bubbles.append(row);
 }
 const input=el('textarea',{'aria-label':'Message to '+c.title,placeholder:'Message '+c.title,rows:2,required:true,maxlength:20000});
 input.value=unsent.get(c.id)||'';input.addEventListener('input',()=>unsent.set(c.id,input.value));
 const send=el('button',{type:'submit',class:'primary'},'Send');
 const error=el('p',{class:'form-error',role:'alert'}),composer=el('form',{class:'chat-composer'},input,send,error);
 composer.addEventListener('submit',async e=>{e.preventDefault();if(!input.value.trim())return;send.disabled=true;input.disabled=true;const text=input.value;unsent.delete(c.id);try{await ui.perform('messages.send',{conversation_id:c.id,text});}catch(err){unsent.set(c.id,text);error.textContent=err.message;send.disabled=false;input.disabled=false;}});
 return el('article',{class:'chat-thread'},el('header',{class:'chat-title'},avatar(c.title),el('div',{},el('h2',{},c.title),el('small',{},c.participant_ids.map(human).join(', ')))),bubbles,ui.has('messages.send')&&!c.archived?composer:null);
}
Object.assign(config,{
 symbol:'☏',searchLabel:'Search messages',load:async ui=>ui.has('messages.conversations')?await ui.call('messages.conversations',{}):{conversations:[]},
 sections:ui=>[{id:'all',label:'All conversations',symbol:'☷'},...(ui.aux.conversations||[]).map(c=>({id:c.id,label:c.title,symbol:'◉',filter:m=>m.conversation_id===c.id}))],
 renderList:(items,ui)=>{const threads=el('div',{});for(const c of ui.aux.conversations||[]){const ms=items.filter(m=>m.conversation_id===c.id);if(ui.section!=='all'&&ui.section!==c.id)continue;const last=ms.at(-1);threads.append(el('button',{class:'record thread-row',onclick:()=>last?ui.select(last.id).catch(ui.error):ui.navigate(c.id).catch(ui.error)},avatar(c.title),el('span',{},el('strong',{},c.title),el('small',{},last?.retracted?'Message retracted':last?.text||'Start a conversation'))));}return threads;},
 view:thread,emptyView:ui=>thread(null,ui),
 field:(name,ui)=>name==='conversation_id'?{options:(ui.aux.conversations||[]).map(c=>({value:c.id,label:c.title}))}:name==='participant_ids'?{help:'Use person references provided by your task setup.'}:{},
 sectionAfter:tool=>tool==='messages.conversation.create'?'all':null
});
config.labels.conversation_id='Conversation';
config.actions.find(a=>a.tool==='messages.attachment.read').available=m=>m.attachments.length>0;
config.actions.find(a=>a.tool==='messages.conversations').hidden=true;
config.actions.find(a=>a.tool==='messages.outbound').advanced=true;
mount(config);
