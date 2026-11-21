// Shared UI primitives. Each App owns its action catalog, field labels and data presentation.
// All data comes from the fixed Agent MCP connection; no fixture or admin state is embedded.
export const el=(tag,attrs={},...children)=>{const n=document.createElement(tag);for(const[k,v]of Object.entries(attrs)){if(k==='class')n.className=v;else if(k.startsWith('on'))n.addEventListener(k.slice(2),v);else if(v!==false&&v!=null)n.setAttribute(k,v);}for(const c of children.flat())if(c!=null)n.append(c instanceof Node?c:document.createTextNode(String(c)));return n;};
const title=k=>k.replace(/_/g,' ').replace(/^./,s=>s.toUpperCase());
const clone=v=>v===undefined?undefined:structuredClone(v);
export function download(filename,mime,bytes){const url=URL.createObjectURL(new Blob([bytes],{type:mime}));const a=el('a',{href:url,download:filename});document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function visibleValue(value){if(Array.isArray(value))return value.map(v=>typeof v==='object'?Object.entries(v).map(([k,x])=>title(k)+': '+visibleValue(x)).join(' · '):String(v)).join('\n');if(value&&typeof value==='object')return Object.entries(value).map(([k,v])=>title(k)+': '+visibleValue(v)).join('\n');return value==null?'—':String(value);}
export async function transfer(file){
  if(file.size>1048576)throw Error('File exceeds the local 1 MiB limit.');
  const mime=file.type||({'txt':'text/plain','ics':'text/calendar','json':'application/json','pdf':'application/pdf'}[file.name.split('.').pop()]||'application/octet-stream');
  const buf=await file.arrayBuffer(),bytes=new Uint8Array(buf),sha=new Uint8Array(await crypto.subtle.digest('SHA-256',buf));
  let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));
  const out={filename:file.name,mime_type:mime,base64:btoa(binary),sha256:Array.from(sha,b=>b.toString(16).padStart(2,'0')).join('')};
  // The current media profile accepts optional descriptive metadata; bytes remain authoritative.
  return out;
}
export async function mount(config){
  document.title=config.title+' · PALE';document.body.dataset.app=config.id;
  let csrf='',tools=[],records=[],selected=null,version=null,refreshNumber=0,selectionNumber=0,busy=false;
  let section=sessionStorage.getItem(config.id+'-section')||config.initialSection||'all',aux={};
  const pendingWrites=new Map(),assetNames=new Map();
  const ui={el, get records(){return records}, get selected(){return selected}, get section(){return section}, get aux(){return aux},
    has:name=>tools.some(t=>t.name===name),call,refresh,select,open,perform,attachments,
    error:showError, navigate:async id=>{section=id;sessionStorage.setItem(config.id+'-section',id);await render();},
    action:(name,values={})=>open({...config.actions.find(a=>a.tool===name),defaults:values}).catch(showError),
    record:(item,...content)=>el('button',{type:'button',class:'record','data-record-id':item.id,'aria-pressed':item.id===selected?.id,onclick:()=>select(item.id).catch(showError)},...content)};
  const status=el('p',{role:'status','aria-live':'polite',id:'status'},'Connecting…');
  const search=el('input',{type:'search',placeholder:config.searchLabel||'Search','aria-label':'Search'});
  const list=el('div',{class:'records',id:'records'}),detail=el('section',{class:'detail','aria-label':'Selected record'});
  const globalActions=el('div',{class:'actions'}),recordActions=el('div',{class:'actions'});
  const dialog=el('dialog',{'aria-label':'Business operation'}),form=el('form',{}),fields=el('div',{class:'fields'}),formError=el('p',{role:'alert',class:'form-error'});
  const formTitle=el('h2'),submit=el('button',{type:'submit',class:'primary'},'Save');
  const cancel=el('button',{type:'button',onclick:()=>dialog.close()},'Cancel');
  form.append(formTitle,fields,formError,el('div',{class:'form-actions'},cancel,submit));dialog.append(form);
  const refreshButton=el('button',{type:'button',onclick:()=>refresh().catch(showError)},'Refresh');
  const nav=el('nav',{'aria-label':config.title+' navigation'}),sectionTitle=el('h2',{class:'section-title'},config.title);
  const collectionHead=el('div',{class:'collection-head'},sectionTitle,el('span',{class:'collection-count'}));
  const workspace=el('div',{class:'workspace'},el('section',{class:'collection','aria-label':config.title+' list'},collectionHead,list),detail);
  document.querySelector('#app').replaceChildren(
    el('div',{class:'app-shell'},el('aside',{class:'sidebar'},
      el('div',{class:'brand'},el('span',{class:'brand-mark','aria-hidden':'true'},config.symbol||config.title[0]),el('h1',{},config.title)),
      globalActions,nav,el('div',{class:'sidebar-foot'},el('span',{class:'avatar small','aria-hidden':'true'},'P'),el('div',{},el('strong',{},'Personal workspace'),el('small',{},'Local preview')))),
      el('main',{class:'app-main'},el('header',{class:'toolbar'},search,refreshButton),status,workspace)),dialog);
  function showError(error){status.textContent=error.message;status.dataset.error='true';}
  function loading(value,selectionOnly=false){document.querySelector('#app').setAttribute('aria-busy',String(value));for(const b of document.querySelectorAll(selectionOnly?'.actions button,.detail button,.quick-action':'.record,.actions button,.detail button,.toolbar button,nav button,.quick-action'))b.disabled=value;}
  async function request(url,method='GET',value){
    const r=await fetch(url,{method,headers:method==='POST'?{'Content-Type':'application/json','X-Pale-CSRF':csrf}:{},...(method==='POST'?{body:JSON.stringify(value)}:{})});
    const out=await r.json();if(!r.ok)throw Error(out.error||'Request failed');return out;
  }
  async function call(name,args){const r=await request('/api/call','POST',{name,arguments:args});if(!['ok','committed','ready'].includes(r.status)){const message={stale_version:'This record changed. Close this form and refresh before trying again.',permission_denied:'This operation is not allowed for the current account and policy.'}[r.status]||r.message||r.status;throw Object.assign(Error(message),{code:r.status});}return r;}
  async function refresh(preferredId=selected?.id){
    const ticket=++refreshNumber;loading(true);
    try{
    const discovered=await request('/api/tools');
    tools=discovered.tools;
    const args=clone(config.listArgs||{});
    if(config.queryField&&search.value)args[config.queryField]=search.value;
    const result=await call(config.list,args);if(ticket!==refreshNumber)return;
    version=result.version;records=result[config.collection]||[];
    if(!config.queryField&&search.value)records=records.filter(x=>visibleValue(x).toLowerCase().includes(search.value.toLowerCase()));
    aux=config.load?await config.load(ui):{};
    if(ticket!==refreshNumber)return;
    globalActions.replaceChildren();
    for(const action of config.actions.filter(a=>!a.hidden&&!a.selected&&tools.some(t=>t.name===a.tool)))globalActions.append(actionButton(action));
    await render(preferredId);
    status.textContent='All changes saved';delete status.dataset.error;
    }finally{if(ticket===refreshNumber)loading(false);}
  }
  async function render(preferredId=selected?.id){
    const sections=config.sections?.(ui)||[{id:'all',label:'All '+config.title.toLowerCase()}];
    if(!sections.some(s=>s.id===section))section=sections[0].id;
    const current=sections.find(s=>s.id===section);
    nav.replaceChildren();
    for(const s of sections){const count=records.filter(s.filter||(()=>true)).length;nav.append(el('button',{type:'button','aria-current':s.id===section?'page':false,onclick:()=>ui.navigate(s.id).catch(showError)},el('span',{class:'nav-symbol','aria-hidden':'true'},s.symbol||'•'),el('span',{},s.label),el('small',{},s.count===false?'':count)));}
    let shown=records.filter(current.filter||(()=>true));
    if(config.sort)shown.sort(config.sort);
    sectionTitle.textContent=current.label;collectionHead.querySelector('.collection-count').textContent=shown.length;
    list.replaceChildren();
    if(config.renderList)list.append(config.renderList(shown,ui));
    else for(const item of shown)list.append(config.row?config.row(item,ui):ui.record(item,el('span',{class:'record-title'},config.heading(item)),el('span',{class:'record-subtitle'},config.subtitle(item))));
    if(!shown.length&&!config.renderList)list.append(el('div',{class:'empty'},el('h3',{},'Nothing here yet'),el('p',{},search.value?'Try a different search.':config.empty||'Create something to get started.')));
    const pick=shown.find(x=>x.id===preferredId)||shown[0];
    if(pick)await select(pick.id);else{selected=null;detail.removeAttribute('data-selected-id');detail.replaceChildren(config.emptyView?.(ui)||el('div',{class:'empty'},el('h3',{},'A little space for what’s next'),el('p',{},'Select an item or create something new.')));}
  }
  async function select(id){
    const ticket=++selectionNumber;loading(true,true);
    try{
      const result=await call(config.get,{id});if(ticket!==selectionNumber)return;
      selected=result[config.item]||result.item;version=result.version;
      sessionStorage.setItem(config.id+'-selected',id);
      detail.dataset.selectedId=id;
      for(const b of list.querySelectorAll('[data-record-id]'))b.setAttribute('aria-pressed',String(b.dataset.recordId===id));
      recordActions.replaceChildren();
      const advanced=el('details',{class:'more-actions'},el('summary',{},'More'));
      for(const a of config.actions.filter(a=>!a.hidden&&a.selected&&(!a.available||a.available(selected))&&tools.some(t=>t.name===a.tool))){if(a.advanced)advanced.append(actionButton(a));else recordActions.append(actionButton(a));}
      if(advanced.children.length>1)recordActions.append(advanced);
      const body=config.view?config.view(selected,ui):el('p',{},config.heading(selected));
      detail.replaceChildren(el('div',{class:'detail-actions'},recordActions),body);
    }finally{if(ticket===selectionNumber)loading(false);}
  }
  async function perform(name,args,{refreshAfter=true}={}){
    if(busy)throw Error('An operation is already in progress.');
    const tool=tools.find(t=>t.name===name);if(!tool)throw Error('Operation unavailable');
    const payload=clone(args);let key;
    if(tool.inputSchema.properties.expected_version){payload.expected_version=clone(version);key=name+JSON.stringify(payload);if(!pendingWrites.has(key))pendingWrites.set(key,'web-'+crypto.randomUUID());payload.request_id=pendingWrites.get(key);}
    busy=true;loading(true);
    try{const result=await call(name,payload);if(key)pendingWrites.delete(key);if(refreshAfter)await refresh(result.id||selected?.id);return result;}
    finally{busy=false;loading(false);}
  }
  function attachments(item,tool){
    const area=el('section',{class:'attachments','aria-label':'Attachments'});
    if(!item.attachments?.length||!ui.has(tool))return area;
    area.append(el('h3',{},item.attachments.length+' attachment'+(item.attachments.length===1?'':'s')));
    const grid=el('div',{class:'attachment-grid'});area.append(grid);
    for(const [index,id] of item.attachments.entries()){
      const label=el('strong',{},'Attachment '+(index+1)),meta=el('small',{},'Loading…');
      const card=el('div',{class:'attachment-card'},el('span',{class:'file-symbol','aria-hidden':'true'},'↧'),el('div',{},label,meta));grid.append(card);
      call(tool,{id:item.id,asset_id:id}).then(result=>{
        if(!area.isConnected)return;const f=result.file;assetNames.set(id,f.filename);label.textContent=f.filename;meta.textContent=f.mime_type;
        const bytes=Uint8Array.from(atob(f.base64),c=>c.charCodeAt(0));
        card.append(el('button',{type:'button','aria-label':'Download '+f.filename,onclick:()=>download(f.filename,f.mime_type,bytes)},'Download'));
        if(/^(image\/(png|jpeg)|audio\/|video\/)/.test(f.mime_type))card.append(el('button',{type:'button',onclick:()=>preview(f,bytes)},'Preview'));
      }).catch(()=>{meta.textContent='Unavailable or not permitted';card.classList.add('unavailable');});
    }return area;
  }
  function preview(file,bytes){
    const url=URL.createObjectURL(new Blob([bytes],{type:file.mime_type}));
    const d=el('dialog',{class:'media-preview','aria-label':file.filename}),tag=file.mime_type.startsWith('image/')?'img':file.mime_type.startsWith('audio/')?'audio':'video';
    d.append(el('h2',{},file.filename),el(tag,{src:url,alt:tag==='img'?file.filename:null,controls:tag!=='img'}),el('button',{type:'button',onclick:()=>d.close()},'Close preview'));
    d.addEventListener('close',()=>{URL.revokeObjectURL(url);d.remove();});document.body.append(d);d.showModal();
  }
  function actionButton(action){return el('button',{type:'button',class:action.primary?'primary':'',onclick:()=>open(action).catch(showError)},action.label);}
  function schemaForm(schema,values,parent,prefix='',required=[]){
    const readers=[];
    for(const[key,original]of Object.entries(schema.properties||{})){
      if(['id','expected_version','request_id'].includes(key))continue;
      const nullable=original.anyOf?.some(s=>s.type==='null');
      const s=original.anyOf?.find(x=>x.type!=='null')||original;
      const fieldName=prefix+key,label=config.labels?.[fieldName]||config.labels?.[key]||title(key);
      const value=values?.[key],isRequired=required.includes(key);
      const spec=config.field?.(fieldName,ui)||{};
      if(s.type==='object'&&key!=='file'){
        const group=el('fieldset',{},el('legend',{},key==='patch'?'Changes':label));parent.append(group);
        const read=schemaForm(s,value||{},group,fieldName+'.',s.required||[]);readers.push(async out=>{const v=await read();if(Object.keys(v).length)out[key]=v;});continue;
      }
      const wrap=el('label',{class:'field'},el('span',{},label+(isRequired?' *':'')));let input;
      if(key==='file'||key==='files'){
        input=el('input',{type:'file',multiple:key==='files',required:isRequired,'data-field':fieldName});
        readers.push(async out=>{if(input.files.length){const files=await Promise.all([...input.files].map(transfer));out[key]=key==='file'?files[0]:files;}});
      }else if(spec.options||s.enum||s.type==='boolean'){
        if(spec.options){
          input=el('select',{'data-field':fieldName,required:isRequired,multiple:s.type==='array'});
          if(!isRequired&&s.type!=='array')input.append(el('option',{value:''},spec.emptyLabel||'None'));
          for(const o of spec.options)input.append(el('option',{value:o.value},o.label));
          if(s.type==='array'){for(const option of input.options)option.selected=(value||[]).includes(option.value);}
          else if(value!==undefined&&value!==null)input.value=String(value);
          readers.push(async out=>{if(s.type==='array')out[key]=[...input.selectedOptions].map(o=>o.value);else if(input.value!=='')out[key]=s.type==='integer'?Number(input.value):input.value;else if(nullable)out[key]=null;});
        }else{
        input=el('select',{'data-field':fieldName,required:isRequired});
        if(!isRequired)input.append(el('option',{value:''},'Leave unchanged'));
        for(const v of s.enum||[true,false])input.append(el('option',{value:String(v)},s.type==='boolean'?(v?'Yes':'No'):title(String(v))));
        if(value!==undefined)input.value=String(value);
        readers.push(async out=>{if(input.value!=='')out[key]=s.type==='boolean'?input.value==='true':input.value;});
        }
      }else{
        const multi=s.type==='array'||['body','text','description','notes'].includes(key);
        const datetime=s.format==='date-time',type=datetime?'datetime-local':s.type==='integer'||s.type==='number'?'number':'text';
        input=el(multi?'textarea':'input',{...(!multi?{type}:{}),'data-field':fieldName,required:isRequired,
          ...(s.minimum!==undefined?{min:s.minimum}:{}),...(s.maximum!==undefined?{max:s.maximum}:{}),
          ...(s.maxLength?{maxlength:s.maxLength}:{}),...(multi?{rows:4}:{})});
        if(value!==undefined&&value!==null){
          if(datetime){const date=new Date(value);input.value=new Date(date-date.getTimezoneOffset()*60000).toISOString().slice(0,16);}
          else input.value=Array.isArray(value)?value.join('\n'):String(value);
        }
        if(s.type==='array')wrap.append(el('small',{},'One value per line.'));
        if(datetime)wrap.append(el('small',{},'Your browser’s local time.'));
        readers.push(async out=>{
          const v=input.value;
          if(v===''){if(nullable)out[key]=null;else if(s.type==='array'&&(value!==undefined||isRequired))out[key]=[];else if(isRequired||value!==undefined)out[key]='';return;}
          out[key]=s.type==='array'?v.split(/[\n,]/).map(x=>x.trim()).filter(Boolean):datetime?new Date(v).toISOString():['integer','number'].includes(s.type)?Number(v):v;
        });
      }
      if(spec.placeholder)input.placeholder=spec.placeholder;
      if(spec.help)wrap.append(el('small',{},spec.help));
      wrap.append(input);parent.append(wrap);
    }
    return async()=>{const out={};for(const read of readers)await read(out);return out;};
  }
  async function open(action){
    const tool=tools.find(t=>t.name===action.tool);if(!tool)throw Error('Operation unavailable');
    const item=clone(selected),formVersion=clone(version);let pendingWrite=null;
    let values={...(action.defaults||{}),...(action.prefill? action.prefill(item):{})};
    if(action.selected&&tool.inputSchema.properties.id)values.id=item.id;
    dialog.dataset.operation=action.tool;
    fields.replaceChildren();formError.textContent='';delete formError.dataset.code;formTitle.textContent=action.label;submit.textContent=action.submit||action.label;
    const read=schemaForm(tool.inputSchema,values,fields,'',tool.inputSchema.required||[]);
    // Attachment choices use only IDs already visible on this record.
    const assetInput=fields.querySelector('[data-field=asset_id]');
    if(assetInput&&item?.attachments){const choice=el('select',{'data-field':'asset_id',required:true});for(const [i,id] of item.attachments.entries())choice.append(el('option',{value:id},assetNames.get(id)||'Attachment '+(i+1)));choice.addEventListener('change',()=>{assetInput.value=choice.value});assetInput.value=choice.value;assetInput.hidden=true;assetInput.removeAttribute('data-field');assetInput.after(choice);}
    if(!fields.children.length)fields.append(el('p',{},item?'Apply this action to “'+config.heading(item)+'”?':'Run this action?'));
    form.onsubmit=async event=>{
      event.preventDefault();if(busy)return;busy=true;submit.disabled=true;formError.textContent='';
      try{
        const args=await read();if(values.id)args.id=values.id;
        // Send only edited fields. A Task may allow rescheduling but forbid title/attendee edits.
        if(args.patch&&item){
          const properties=tool.inputSchema.properties.patch.properties;
          for(const [key,value]of Object.entries(args.patch)){
            const original=item[key],schema=properties[key],date=schema?.format==='date-time'||schema?.anyOf?.some(x=>x.format==='date-time');
            if(JSON.stringify(value)===JSON.stringify(original)||(value===null&&original===undefined)||
              (date&&value&&original&&Date.parse(value)===Date.parse(original)))delete args.patch[key];
          }
          if(!Object.keys(args.patch).length)throw Error('No changes to save.');
        }
        if(tool.inputSchema.properties.expected_version){
          args.expected_version=formVersion;
          const signature=JSON.stringify(args);
          if(!pendingWrite||pendingWrite.signature!==signature)pendingWrite={signature,id:'web-'+crypto.randomUUID()};
          args.request_id=pendingWrite.id;
        }
        const result=await call(action.tool,args);
        if(result.file){const f=result.file;download(f.filename,f.mime_type,Uint8Array.from(atob(f.base64),c=>c.charCodeAt(0)));}
        if(result.text&&result.mime_type)download('event.ics',result.mime_type,result.text);
        if(action.exportResult)download(action.exportResult,'application/json',JSON.stringify(result,null,2));
        dialog.close();
        // Keep newly created or moved items visible in their destination folder.
        if(config.sectionAfter){const next=config.sectionAfter(action.tool,args,result,item,ui);if(next){section=next;sessionStorage.setItem(config.id+'-section',section);}}
        await refresh(result.id||item?.id);
        if(!tool.inputSchema.properties.expected_version&&!result.file&&!result.text&&!action.exportResult){
          const output=el('section',{class:'query-result'},el('h3',{},action.label));
          for(const [key,value]of Object.entries(result))if(!['status','version','app_id'].includes(key))output.append(el('h4',{},title(key)),el('pre',{},visibleValue(value)));
          detail.append(output);
        }
        status.textContent=action.success||'Action completed.';
      }catch(e){formError.textContent=e.message;formError.dataset.code=e.code||'request_failed';}
      finally{busy=false;submit.disabled=false;}
    };
    dialog.showModal();fields.querySelector('input,textarea,select')?.focus();
  }
  search.addEventListener('input',()=>refresh().catch(showError));
  try{
    const token=new URLSearchParams(location.hash.slice(1)).get('access');
    if(token){history.replaceState(null,'',location.pathname);({csrf}=await request('/session','POST',{token}));}
    else ({csrf}=await request('/session'));
    await refresh(sessionStorage.getItem(config.id+'-selected'));
  }catch(e){showError(e);}
}

// Presentation helpers accept already-authorized App data only.
export const human=k=>String(k||'').replace(/^person[-_:]/,'').replace(/[._-]/g,' ').replace(/\b\w/g,c=>c.toUpperCase());
export const date=(value,options={})=>value&&Number.isFinite(Date.parse(value))?new Intl.DateTimeFormat('en-US',{month:'short',day:'numeric',...options}).format(new Date(value)):'No date';
export const time=value=>date(value,{hour:'numeric',minute:'2-digit'});
export const avatar=name=>el('span',{class:'avatar','aria-hidden':'true'},String(name||'?').split(/[\s.@_-]+/).slice(0,2).map(x=>x[0]).join('').toUpperCase());
export const tag=text=>el('span',{class:'tag'},text);
export const textBlock=text=>el('div',{class:'body-text'},text||'');
export const metadata=(label,value)=>el('div',{class:'metadata-line'},el('span',{},label),el('strong',{},value||'—'));
