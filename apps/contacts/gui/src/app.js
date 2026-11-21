import {mount,el,avatar,date,time,human,tag,textBlock,metadata,transfer} from '/shared/client.js';
// App-owned interaction catalog and presentation. The Host only supplies an Agent connection.
export const config={
 id:'contacts',title:'Contacts',description:'Keep people, contact details and shared identity references together.',
 list:'contacts.list',collection:'items',queryField:'query',listArgs:{include_inactive:true},get:'contacts.get',item:'item',
 heading:c=>c.display_name,subtitle:c=>c.organization+(c.archived?' · Archived':''),
 labels:{display_name:'Name',person_id:'Bound person ID',emails:'Email addresses',phones:'Phone numbers'},
 actions:[
  {label:'New contact',tool:'contacts.create',primary:true},
  {label:'Edit contact',tool:'contacts.update',selected:true,prefill:c=>({patch:{display_name:c.display_name,person_id:c.person_id,emails:c.emails,phones:c.phones,organization:c.organization,groups:c.groups,notes:c.notes}})},
  {label:'Archive or restore',tool:'contacts.flags',selected:true,prefill:c=>({patch:{archived:!c.archived}})}
 ]
};


Object.assign(config,{
 symbol:'◎',searchLabel:'Search people',initialSection:'all',
 sections:ui=>[{id:'all',label:'All contacts',symbol:'◎',filter:c=>!c.archived},...Array.from(new Set(ui.records.flatMap(c=>c.groups))).map(g=>({id:'group:'+g,label:human(g),symbol:'♧',filter:c=>c.groups.includes(g)&&!c.archived})),{id:'archived',label:'Archived',symbol:'▣',filter:c=>c.archived}],
 sort:(a,b)=>a.display_name.localeCompare(b.display_name),
 row:(c,ui)=>ui.record(c,el('div',{class:'contact-row'},avatar(c.display_name),el('span',{},el('strong',{},c.display_name),el('small',{},c.organization||c.emails[0]||'Contact')))),
 view:c=>el('article',{class:'contact-reader'},el('div',{class:'contact-hero'},avatar(c.display_name),el('h2',{},c.display_name),el('p',{},c.organization),el('div',{class:'tags'},c.groups.map(tag))),
   el('section',{class:'contact-info'},c.emails.map(a=>metadata('Email',a)),c.phones.map(n=>metadata('Phone',n))),c.notes?el('section',{},el('h3',{},'Notes'),textBlock(c.notes)):null),
 field:name=>name.endsWith('person_id')?{help:'Optional reference linking this contact to a person in your task setup.'}:{},
 sectionAfter:(tool,args)=>tool==='contacts.flags'?(args.patch.archived?'archived':'all'):tool==='contacts.create'?'all':null
});
config.labels.person_id='Linked person reference (optional)';
mount(config);
