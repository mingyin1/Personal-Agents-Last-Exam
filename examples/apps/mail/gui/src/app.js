import {mount,el,avatar,date,time,human,tag,textBlock,metadata,transfer} from '/shared/client.js';
// App-owned interaction catalog and presentation. The Host only supplies an Agent connection.
export const config={
 id:'mail', title:'Mail', description:'Read your inbox, manage drafts and organize messages.',
 list:'mail.search', collection:'messages', queryField:'query', get:'mail.get', item:'message',
 heading:m=>m.subject, subtitle:m=>m.folder+' · '+m.from,
 labels:{to:'To (email addresses)',body:'Message',read:'Mark as read',folder:'Destination folder',files:'Attachments'},
 actions:[
  {label:'Compose',tool:'mail.draft.create',primary:true,submit:'Save draft'},
  {label:'Edit draft',tool:'mail.draft.update',selected:true,available:m=>m.folder==='drafts',prefill:m=>({patch:{to:m.to,subject:m.subject,body:m.body}})},
  {label:'Send draft',tool:'mail.send',selected:true,available:m=>m.folder==='drafts',success:'Saved to Sent.'},
  {label:'Read status',tool:'mail.flags.update',selected:true,prefill:m=>({read:!m.read})},
  {label:'Move',tool:'mail.move',selected:true,prefill:m=>({folder:m.folder})},
  {label:'Trash',tool:'mail.trash',selected:true},
  {label:'Add attachments',tool:'mail.attachment.add',selected:true,available:m=>m.folder==='drafts'},
  {label:'Download attachment',tool:'mail.attachment.get',selected:true},
  {label:'Remove attachment',tool:'mail.attachment.remove',selected:true,available:m=>m.folder==='drafts'}
 ]
};


const folders=[['inbox','Inbox','▣'],['drafts','Drafts','✎'],['sent','Sent','↗'],['archive','Archive','▤'],['trash','Trash','⌫']];
Object.assign(config,{
 symbol:'✉',initialSection:'inbox',searchLabel:'Search mail',empty:'Your mail will appear here.',
 sections:()=>folders.map(([id,label,symbol])=>({id,label,symbol,filter:m=>m.folder===id})),
 sort:(a,b)=>Date.parse(b.received_at)-Date.parse(a.received_at),
 row:(m,ui)=>ui.record(m,el('div',{class:'mail-row '+(!m.read?'unread':'')},
   el('div',{class:'row-top'},el('strong',{},human(m.from.split('@')[0])),el('time',{},date(m.received_at))),
   el('span',{class:'record-title'},m.subject||'(No subject)'),el('span',{class:'snippet'},m.body),
   el('div',{class:'row-bottom'},!m.read?tag('Unread'):null,m.attachments.length?el('small',{},'↧ '+m.attachments.length+' attachments'):null))),
 view:(m,ui)=>el('article',{class:'mail-reader'},el('div',{class:'reader-heading'},el('span',{class:'kicker'},m.folder==='drafts'?'Draft':folders.find(f=>f[0]===m.folder)?.[1]||m.folder),el('h2',{},m.subject||'(No subject)')),
   el('div',{class:'sender-line'},avatar(m.from),el('div',{},el('strong',{},human(m.from.split('@')[0])),el('small',{},m.from),el('small',{},'To: '+m.to.join(', '))),el('time',{},time(m.received_at))),
   textBlock(m.body),ui.attachments(m,'mail.attachment.get'),
   m.folder!=='drafts'&&ui.has('mail.draft.create')?el('div',{class:'reader-footer'},el('button',{type:'button',onclick:()=>ui.action('mail.draft.create',{to:[m.from],subject:'Re: '+m.subject,body:'\n\nOn '+time(m.received_at)+', '+m.from+' wrote:\n'+m.body})},'Reply'),el('button',{type:'button',onclick:()=>ui.action('mail.draft.create',{subject:'Fwd: '+m.subject,body:'Forwarded message\nFrom: '+m.from+'\n\n'+m.body})},'Forward')):null),
 field:name=>name.endsWith('folder')?{options:folders.map(([value,label])=>({value,label}))}:name.endsWith('to')?{placeholder:'alex@example.com',help:'Separate recipients with commas.'}:{},
 sectionAfter:(tool,args)=>tool==='mail.draft.create'?'drafts':tool==='mail.send'?'sent':tool==='mail.trash'?'trash':tool==='mail.move'?args.folder:null
});
config.labels.to='To';
config.actions.find(a=>a.tool==='mail.attachment.get').available=m=>m.attachments.length>0;
config.actions.find(a=>a.tool==='mail.attachment.remove').available=m=>m.folder==='drafts'&&m.attachments.length>0;
mount(config);
