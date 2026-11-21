import {mount,el,avatar,date,time,human,tag,textBlock,metadata,transfer} from '/shared/client.js';
// App-owned interaction catalog and presentation. The Host only supplies an Agent connection.
export const config={
 id:'notes',title:'Notes',description:'Capture preferences, ideas and reference material.',
 list:'notes.list',collection:'items',queryField:'query',listArgs:{include_inactive:true},get:'notes.get',item:'item',
 heading:n=>n.title,subtitle:n=>(n.pinned?'Pinned · ':'')+(n.trashed?'Trashed':n.archived?'Archived':n.tags.join(', ')),
 labels:{body:'Note',tags:'Tags',files:'Attachments'},
 actions:[
  {label:'New note',tool:'notes.create',primary:true},
  {label:'Edit note',tool:'notes.update',selected:true,prefill:n=>({patch:{title:n.title,body:n.body,tags:n.tags,pinned:n.pinned}})},
  {label:'Organize note',tool:'notes.flags',selected:true,prefill:n=>({patch:{pinned:n.pinned,archived:n.archived,trashed:n.trashed}})},
  {label:'Add attachments',tool:'notes.attachment.add',selected:true},
  {label:'Download attachment',tool:'notes.attachment.read',selected:true}
 ]
};


Object.assign(config,{
 symbol:'▧',searchLabel:'Search your notes',initialSection:'all',
 sections:ui=>[{id:'all',label:'All notes',symbol:'▤',filter:n=>!n.archived&&!n.trashed},{id:'pinned',label:'Pinned',symbol:'⌖',filter:n=>n.pinned&&!n.trashed},...Array.from(new Set(ui.records.flatMap(n=>n.tags))).map(t=>({id:'tag:'+t,label:'# '+t,filter:n=>n.tags.includes(t)&&!n.trashed})),{id:'archive',label:'Archive',symbol:'▣',filter:n=>n.archived&&!n.trashed},{id:'trash',label:'Trash',symbol:'⌫',filter:n=>n.trashed}],
 sort:(a,b)=>Number(b.pinned)-Number(a.pinned)||Date.parse(b.updated_at)-Date.parse(a.updated_at),
 row:(n,ui)=>ui.record(n,el('div',{class:'note-row'},el('span',{class:'note-title'},n.pinned?el('span',{class:'pin','aria-label':'Pinned'},'⌖'):null,n.title),el('span',{class:'snippet'},n.body||'Empty note'),el('div',{class:'row-bottom'},el('time',{},date(n.updated_at)),n.tags.map(tag)))),
 view:(n,ui)=>el('article',{class:'note-paper'},el('div',{class:'note-date'},time(n.updated_at)),el('h2',{},n.title),el('div',{class:'tags'},n.tags.map(tag)),textBlock(n.body||'This note is empty.'),ui.attachments(n,'notes.attachment.read'),el('div',{class:'note-foot'},n.revisions.length?'Edited '+n.revisions.length+' time'+(n.revisions.length===1?'':'s'):'Created '+date(n.created_at))),
 sectionAfter:(tool,args)=>tool==='notes.create'?'all':tool==='notes.flags'?(args.patch.trashed?'trash':args.patch.archived?'archive':'all'):null
});
config.actions.find(a=>a.tool==='notes.attachment.read').available=n=>n.attachments.length>0;
mount(config);
