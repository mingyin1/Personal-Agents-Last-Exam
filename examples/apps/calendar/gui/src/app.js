import {mount,el,avatar,date,time,human,tag,textBlock,metadata,transfer} from '/shared/client.js';
// App-owned interaction catalog and presentation. The Host only supplies an Agent connection.
export const config={
 id:'calendar',title:'Calendar',description:'Plan your time, check availability and manage events.',
 list:'calendar.list',collection:'events',listArgs:{include_cancelled:true},get:'calendar.get',item:'event',
 heading:e=>e.title,subtitle:e=>e.start+' · '+e.status,
 labels:{timezone:'Event timezone',text:'iCalendar content',exclude_id:'Exclude event ID'},
 actions:[
  {label:'New event',tool:'calendar.create',primary:true,defaults:{timezone:'America/Los_Angeles'}},
  {label:'Check availability',tool:'calendar.freebusy'},
  {label:'Import calendar',tool:'calendar.import_ics'},
  {label:'Edit event',tool:'calendar.update',selected:true,available:e=>e.status!=='cancelled',prefill:e=>({patch:{title:e.title,start:e.start,end:e.end,location:e.location,attendees:e.attendees}})},
  {label:'Cancel event',tool:'calendar.cancel',selected:true,available:e=>e.status!=='cancelled'},
  {label:'Export calendar',tool:'calendar.export_ics',selected:true},
  {label:'Add attachments',tool:'calendar.attachment.add',selected:true,available:e=>e.status!=='cancelled'},
  {label:'Download attachment',tool:'calendar.attachment.get',selected:true},
  {label:'Remove attachment',tool:'calendar.attachment.remove',selected:true,available:e=>e.status!=='cancelled'}
 ]
};


let month=null;
const dayKey=d=>[d.getFullYear(),d.getMonth(),d.getDate()].join('-');
Object.assign(config,{
 symbol:'▦',searchLabel:'Search events',initialSection:'active',
 sections:()=>[{id:'active',label:'My calendar',symbol:'▦',filter:e=>e.status!=='cancelled'},{id:'all',label:'All events',symbol:'≡'},{id:'cancelled',label:'Cancelled',symbol:'×',filter:e=>e.status==='cancelled'}],
 renderList:(events,ui)=>{
   if(!month)month=new Date(events[0]?.start||Date.now());
   const title=el('h3',{},month.toLocaleDateString('en-US',{month:'long',year:'numeric'}));
   const move=n=>{month=new Date(month.getFullYear(),month.getMonth()+n,1);ui.navigate(ui.section).catch(ui.error)};
   const head=el('div',{class:'calendar-toolbar'},title,el('div',{},el('button',{'aria-label':'Previous month',onclick:()=>move(-1)},'‹'),el('button',{'aria-label':'Next month',onclick:()=>move(1)},'›'),el('button',{onclick:()=>{month=new Date();ui.navigate(ui.section).catch(ui.error)}},'Today')));
   const grid=el('div',{class:'month-grid','aria-label':'Month calendar'});
   for(const d of ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'])grid.append(el('div',{class:'weekday'},d));
   const first=new Date(month.getFullYear(),month.getMonth(),1),start=new Date(first);start.setDate(1-first.getDay());
   for(let i=0;i<42;i++){
     const d=new Date(start);d.setDate(start.getDate()+i);
     const dayNumber=ui.has('calendar.create')?el('button',{class:dayKey(d)===dayKey(new Date())?'day-number today':'day-number','aria-label':'New event on '+d.toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric'}),onclick:()=>{const start=new Date(d);start.setHours(9,0,0,0);const end=new Date(start);end.setHours(10);ui.action('calendar.create',{start:start.toISOString(),end:end.toISOString(),timezone:Intl.DateTimeFormat().resolvedOptions().timeZone})}},d.getDate()):el('span',{class:'day-number'},d.getDate());
     const cell=el('div',{class:'calendar-day'+(d.getMonth()!==month.getMonth()?' adjacent':'')},dayNumber);
     for(const e of events.filter(e=>dayKey(new Date(e.start))===dayKey(d)))cell.append(el('button',{class:'calendar-event '+e.status,'data-event-id':e.id,onclick:()=>ui.select(e.id).catch(ui.error)},new Date(e.start).toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'}),el('strong',{},e.title)));
     grid.append(cell);
   }
   const agenda=el('div',{class:'agenda'},el('h3',{},'Schedule'));
   for(const e of [...events].sort((a,b)=>Date.parse(a.start)-Date.parse(b.start)))agenda.append(ui.record(e,el('span',{class:'date-tile'},el('strong',{},new Date(e.start).getDate()),el('small',{},date(e.start,{month:'short',day:undefined}))),el('span',{},el('strong',{},e.title),el('small',{},time(e.start)+' · '+e.location))));
   if(!events.length)agenda.append(el('p',{class:'empty'},'No events. Add something to your calendar.'));
   return el('div',{},head,grid,agenda);
 },
 view:(e,ui)=>el('article',{class:'event-reader'},el('span',{class:'kicker'},'Event details'),el('h2',{},e.title),tag(human(e.status)),
   el('div',{class:'event-time'},el('div',{class:'date-tile large'},el('strong',{},new Date(e.start).getDate()),el('small',{},date(e.start,{month:'short',day:undefined}))),el('div',{},el('strong',{},date(e.start,{weekday:'long',year:'numeric'})),el('p',{},new Date(e.start).toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'})+' – '+new Date(e.end).toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'})),el('small',{},'Displayed in '+Intl.DateTimeFormat().resolvedOptions().timeZone))),
   metadata('Location',e.location||'No location'),metadata('Event timezone',e.timezone),el('h3',{},'Guests'),el('div',{class:'people'},e.attendees.map(p=>el('div',{class:'person'},avatar(human(p)),el('span',{},human(p))))),ui.attachments(e,'calendar.attachment.get')),
 sectionAfter:(tool,args)=>{if(tool==='calendar.create')month=new Date(args.start);return tool==='calendar.cancel'?'all':null}
});
config.actions.find(a=>a.tool==='calendar.attachment.get').available=e=>(e.attachments||[]).length>0;
config.actions.find(a=>a.tool==='calendar.attachment.remove').available=e=>e.status!=='cancelled'&&(e.attachments||[]).length>0;
mount(config);
