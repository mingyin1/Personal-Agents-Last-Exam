import {mount,el,avatar,date,time,human,tag,textBlock,metadata,transfer} from '/shared/client.js';
// App-owned interaction catalog and presentation. The Host only supplies an Agent connection.
export const config={
 id:'tasks',title:'Tasks',description:'Track commitments, deadlines and the work that depends on them.',
 list:'tasks.list',collection:'items',queryField:'query',listArgs:{include_inactive:true},get:'tasks.get',item:'item',
 heading:t=>t.title,subtitle:t=>t.status.replace(/_/g,' ')+' · '+t.list,
 labels:{assignee_person_id:'Assignee person ID',due_at:'Due time',blocked_by:'Blocking task IDs',priority:'Priority (0–3)'},
 actions:[
  {label:'New task',tool:'tasks.create',primary:true},
  {label:'Edit task',tool:'tasks.update',selected:true,prefill:t=>({patch:{title:t.title,description:t.description,list:t.list,assignee_person_id:t.assignee_person_id,due_at:t.due_at,priority:t.priority,tags:t.tags,blocked_by:t.blocked_by}})},
  {label:'Change status',tool:'tasks.transition',selected:true,prefill:t=>({status:t.status})}
 ]
};


const priorities=['No priority','Low','Medium','High'];
Object.assign(config,{
 symbol:'✓',searchLabel:'Search tasks',initialSection:'all',
 sections:ui=>[{id:'all',label:'My tasks',symbol:'☷',filter:t=>!['completed','cancelled'].includes(t.status)},{id:'upcoming',label:'Scheduled',symbol:'▦',filter:t=>!!t.due_at&&!['completed','cancelled'].includes(t.status)},...Array.from(new Set(ui.records.map(t=>t.list))).map(l=>({id:'list:'+l,label:l,symbol:'≡',filter:t=>t.list===l})),{id:'completed',label:'Completed',symbol:'✓',filter:t=>t.status==='completed'},{id:'cancelled',label:'Cancelled',symbol:'×',filter:t=>t.status==='cancelled'}],
 row:(t,ui)=>{const wrap=el('div',{class:'task-row '+t.status});const check=el('input',{type:'checkbox',class:t.status==='cancelled'||!ui.has('tasks.transition')?'':'quick-action','aria-label':'Complete '+t.title,checked:t.status==='completed',disabled:t.status==='cancelled'||!ui.has('tasks.transition')});check.addEventListener('change',async()=>{check.disabled=true;try{await ui.perform('tasks.transition',{id:t.id,status:check.checked?'completed':'todo'});}catch(e){check.checked=t.status==='completed';check.disabled=false;ui.error(e);}});wrap.append(check,ui.record(t,el('span',{class:'record-title'},t.title),el('span',{class:'record-subtitle'},t.due_at?date(t.due_at)+' · '+t.list:t.list)),el('span',{class:'priority p'+t.priority,title:priorities[t.priority]},t.priority?'!'.repeat(t.priority):''));return wrap;},
 view:(t,ui)=>el('article',{class:'task-reader'},el('span',{class:'kicker'},t.list),el('h2',{},t.title),el('div',{class:'tags'},tag(human(t.status)),tag(priorities[t.priority])),textBlock(t.description||'No description'),metadata('Due',t.due_at?time(t.due_at):'Not scheduled'),metadata('Assigned to',t.assignee_person_id?human(t.assignee_person_id):'Unassigned'),el('div',{class:'tags'},t.tags.map(tag)),t.blocked_by.length?el('section',{},el('h3',{},'Waiting on'),t.blocked_by.map(id=>el('p',{},ui.records.find(r=>r.id===id)?.title||'Linked task'))):null),
 field:(name,ui)=>name.endsWith('priority')?{options:priorities.map((label,i)=>({value:String(i),label}))}:name.endsWith('blocked_by')?{options:ui.records.filter(t=>t.id!==ui.selected?.id).map(t=>({value:t.id,label:t.title}))}:{},
 sectionAfter:(tool,args)=>tool==='tasks.transition'&&['completed','cancelled'].includes(args.status)?args.status:tool==='tasks.create'?'all':null
});
config.labels.priority='Priority';config.labels.blocked_by='Waiting on';config.labels.assignee_person_id='Assignee reference';
mount(config);
