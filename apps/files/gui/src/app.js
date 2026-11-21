import {mount,el,avatar,date,time,human,tag,textBlock,metadata,transfer} from '/shared/client.js';
// App-owned interaction catalog and presentation. The Host only supplies an Agent connection.
export const config={
 id:'files',title:'Files',description:'Keep original files, folders and their version history.',
 list:'files.list',collection:'items',queryField:'query',listArgs:{include_inactive:true},get:'files.get',item:'item',
 heading:f=>f.name,subtitle:f=>f.kind+(f.trashed?' · Trashed':'')+' · '+f.versions.length+' versions',
 labels:{parent_id:'Parent folder ID (blank for root)',file:'File',source:'Source note',number:'Version number (blank for latest)'},
 actions:[
  {label:'Upload file',tool:'files.put',primary:true},
  {label:'New folder',tool:'files.mkdir'},
  {label:'Rename or move',tool:'files.move',selected:true,prefill:f=>({patch:{name:f.name,parent_id:f.parent_id}})},
  {label:'Upload new version',tool:'files.put',selected:true},
  {label:'Download file',tool:'files.read',selected:true,available:f=>f.kind==='file'},
  {label:'Trash or restore',tool:'files.trash',selected:true,prefill:f=>({trashed:!f.trashed})}
 ]
};


Object.assign(config,{
 symbol:'▰',searchLabel:'Search files and folders',initialSection:'all',
 sections:ui=>[{id:'all',label:'All files',symbol:'▰',filter:f=>!f.trashed},{id:'root',label:'My files',symbol:'⌂',filter:f=>!f.trashed&&!f.parent_id},...ui.records.filter(f=>f.kind==='folder'&&!f.trashed).map(f=>({id:f.id,label:f.name,symbol:'▱',filter:x=>!x.trashed&&x.parent_id===f.id})),{id:'trash',label:'Trash',symbol:'⌫',filter:f=>f.trashed}],
 row:(f,ui)=>{const b=ui.record(f,el('span',{class:'file-icon '+f.kind,'aria-hidden':'true'},f.kind==='folder'?'▰':f.name.split('.').pop().slice(0,4).toUpperCase()),el('span',{class:'record-title'},f.name),el('span',{class:'record-subtitle'},f.kind==='folder'?'Folder':date(f.updated_at)+' · v'+f.versions.length));if(f.kind==='folder')b.addEventListener('dblclick',()=>ui.navigate(f.id).catch(ui.error));return b;},
 view:(f,ui)=>el('article',{class:'file-reader'},el('span',{class:'file-hero '+f.kind,'aria-hidden':'true'},f.kind==='folder'?'▰':f.name.split('.').pop().slice(0,4).toUpperCase()),el('h2',{},f.name),
   f.kind==='folder'?el('button',{class:'primary',onclick:()=>ui.navigate(f.id).catch(ui.error)},'Open folder'):null,
   metadata('Location',ui.records.find(x=>x.id===f.parent_id)?.name||'My files'),metadata('Modified',time(f.updated_at)),metadata('Created',time(f.created_at)),
   f.kind==='file'?el('section',{},el('h3',{},'Version history'),[...f.versions].reverse().map(v=>el('div',{class:'version-entry'},el('span',{class:'version-number'},'v'+v.number),el('div',{},el('strong',{},v.source||'Uploaded file'),el('small',{},time(v.at))),ui.has('files.read')?el('button',{onclick:async()=>{try{const r=await ui.call('files.read',{id:f.id,number:v.number});const a=document.createElement('a');const url=URL.createObjectURL(new Blob([Uint8Array.from(atob(r.file.base64),c=>c.charCodeAt(0))],{type:r.file.mime_type}));a.href=url;a.download=r.file.filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}catch(e){ui.error(e)}}},'Download'):null))):el('p',{class:'muted'},'Double-click a folder to browse its contents.')),
 field:(key,ui)=>key.endsWith('parent_id')?{options:ui.records.filter(f=>f.kind==='folder'&&!f.trashed&&(key!=='patch.parent_id'||f.id!==ui.selected?.id)).map(f=>({value:f.id,label:f.name})),emptyLabel:'My files (root)'}:{},
 sectionAfter:(tool,args)=>tool==='files.trash'?(args.trashed?'trash':'all'):['files.put','files.mkdir'].includes(tool)?'all':null
});
config.labels.parent_id='Folder';config.labels['patch.parent_id']='Folder';
config.actions.find(a=>a.label==='Upload new version').available=f=>f.kind==='file'&&!f.trashed;
mount(config);
