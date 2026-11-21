'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {chromium}=require('playwright');
const {start}=require('./server.cjs'),{Client}=require('../client.cjs'),{digestTree}=require('../verify.cjs');
const root=path.resolve(__dirname,'../..'),out=path.resolve(process.env.PALE_WEB_REPORT_DIR||path.join(root,'.artifacts/web'));
const apps=['mail','calendar','files','messages','notes','tasks','contacts'];
const configs={
 mail:{create:'Compose',fields:{to:'alex@example.test',subject:'GUI mail',body:'Written in browser'},collection:'messages',key:'subject',value:'GUI mail',edit:'Edit draft',changes:{'patch.subject':'GUI mail edited'},updated:'GUI mail edited'},
 calendar:{create:'New event',fields:{title:'GUI event',start:'2026-12-01T10:00',end:'2026-12-01T11:00',timezone:'America/Los_Angeles'},collection:'events',key:'title',value:'GUI event',edit:'Edit event',changes:{'patch.title':'GUI event edited'},updated:'GUI event edited'},
 files:{create:'New folder',fields:{name:'GUI folder'},collection:'files',key:'name',value:'GUI folder',edit:'Rename or move',changes:{'patch.name':'GUI folder edited'},updated:'GUI folder edited'},
 messages:{create:'New message',fields:{conversation_id:'conversation-home',text:'GUI message'},collection:'messages',key:'text',value:'GUI message',edit:'Edit message',changes:{text:'GUI message edited'},updated:'GUI message edited'},
 notes:{create:'New note',fields:{title:'GUI note',body:'<img src=x onerror="window.injected=true">'},collection:'notes',key:'title',value:'GUI note',edit:'Edit note',changes:{'patch.title':'GUI note edited'},updated:'GUI note edited'},
 tasks:{create:'New task',fields:{title:'GUI task'},collection:'tasks',key:'title',value:'GUI task',edit:'Edit task',changes:{'patch.title':'GUI task edited'},updated:'GUI task edited'},
 contacts:{create:'New contact',fields:{display_name:'GUI contact',emails:'gui@example.test'},collection:'contacts',key:'display_name',value:'GUI contact',edit:'Edit contact',changes:{'patch.display_name':'GUI contact edited'},updated:'GUI contact edited'}
};
(async()=>{
 fs.mkdirSync(out,{recursive:true});
 const stateDir=fs.mkdtempSync(path.join(os.tmpdir(),'pale-browser-'));
 const browser=await chromium.launch({headless:true});
 const report={schema:'pale.web-acceptance.v1',checked_at:new Date().toISOString(),node:process.version,browser:browser.version(),apps:[],passed:false};
 try{
  for(const app of (process.env.PALE_WEB_APPS||apps.join(',')).split(',')){
   const c=configs[app],appDir=path.join(root,['mail','calendar'].includes(app)?'examples/apps':'apps',app),checks=[];
   let host,context,infra,page;
   const record=(name,condition=true)=>{assert.ok(condition,name);checks.push(name);};
   try{
    host=await start({app,stateDir,run:'browser-'+app});
    infra=new Client(app,'infra',host.run,stateDir,'web-acceptance-inspector',{registry:host.registry});await infra.initialize();
    context=await browser.newContext({viewport:{width:1280,height:900}});page=await context.newPage();page.setDefaultTimeout(7000);
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto(host.accessUrl);await page.locator('#records .record').first().waitFor();await page.locator('#app[aria-busy=false]').waitFor();
    record('Public Host loads App-owned interface');
    const allowed=(await host.client.request('tools/list')).result.tools.map(t=>t.name);
    const controller=fs.readFileSync(path.join(appDir,'gui/src/app.js'),'utf8');
    record('App controller covers every declared business tool',JSON.parse(fs.readFileSync(path.join(appDir,'tools.json'))).every(t=>controller.includes("'"+t.name+"'")));
    record('Business discovery has no management tools',allowed.every(x=>!x.startsWith('env.')));
    const form=page.locator('dialog form');
    const fill=async values=>{for(const[k,v]of Object.entries(values)){const input=form.locator('[data-field="'+k+'"]');if(await input.evaluate(e=>e.tagName)==='SELECT')await input.selectOption(String(v));else await input.fill(String(v));}};
    const begin=async(label,values={})=>{await page.getByRole('button',{name:label,exact:true}).click();await form.waitFor();await fill(values);};
    const finish=async()=>{await form.locator('button[type=submit]').click();await page.locator('dialog').waitFor({state:'hidden'});await page.locator('#app[aria-busy=false]').waitFor();};
    const operate=async(label,values={})=>{await begin(label,values);await finish();};
    const snapshot=async()=>(await infra.call('env.snapshot')).snapshot.data;
    await operate(c.create,c.fields);
    let item=(await snapshot())[c.collection].find(x=>x[c.key]===c.value);record('Browser create commits a real MCP-readable record',!!item);
    if(app==='notes'){
      let dropped=false;
      await page.route('**/api/call',async route=>{
        const payload=route.request().postDataJSON();
        if(!dropped&&payload.name==='notes.create'&&payload.arguments.title==='Recovered note'){
          dropped=true;await route.fetch();await route.abort('failed');
        }else await route.continue();
      });
      await begin('New note',{title:'Recovered note'});await form.locator('button[type=submit]').click();await form.locator('[role=alert]').waitFor();
      await finish();
      record('Retry after a lost committed response has one effect',(await snapshot()).notes.filter(x=>x.title==='Recovered note').length===1);
      await page.unroute('**/api/call');
    }
    await page.locator('[data-record-id="'+item.id+'"]').click();
    await operate(c.edit,c.changes);
    item=(await snapshot())[c.collection].find(x=>x.id===item.id);
    record('Browser edit changes the same backend record',item[c.key]===c.updated);
    await page.reload();await page.locator('[data-record-id="'+item.id+'"]').waitFor();await page.locator('#app[aria-busy=false]').waitFor();
    record('Browser reload retains committed record',await page.locator('[data-record-id="'+item.id+'"]').innerText().then(x=>x.includes(c.updated)));
    await page.locator('[data-record-id="'+item.id+'"]').click();
    await page.locator('.detail[data-selected-id="'+item.id+'"]').waitFor();
    if(app==='notes'){
      record('Untrusted text is displayed, never executed',!(await page.evaluate(()=>window.injected))&&await page.locator('.detail').innerText().then(x=>x.includes('<img src=x')));
      await begin('Edit note',{'patch.title':'Stale overwrite'});
      const before=await infra.call('env.snapshot');
      await host.client.call('notes.update',{id:item.id,patch:{body:'Concurrent MCP edit'},expected_version:before.version,request_id:'external-edit'});
      await form.locator('button[type=submit]').click();await form.locator('[role=alert][data-code=stale_version]').waitFor();
      record('Stale form displays a conflict and preserves concurrent data',(await snapshot()).notes.find(x=>x.id===item.id).body==='Concurrent MCP edit');
      await form.getByRole('button',{name:'Cancel',exact:true}).click();
    }
    if(['mail','calendar','messages','notes'].includes(app)){
      // Refresh after concurrent writes, then select the created parent.
      await page.getByRole('button',{name:'Refresh',exact:true}).click();await page.locator('[data-record-id="'+item.id+'"]').click();
      await begin('Add attachments');
      await form.locator('input[type=file]').setInputFiles({name:'browser-receipt.txt',mimeType:'text/plain',buffer:Buffer.from('Original browser attachment')});await finish();
      const updated=(await snapshot())[c.collection].find(x=>x.id===item.id);record('Browser uploads original attachment bytes',updated.attachments.length===1);
      await page.locator('[data-record-id="'+item.id+'"]').click();
      await begin('Download attachment',{asset_id:updated.attachments[0]});
      const downloaded=page.waitForEvent('download');await finish();const d=await downloaded;const file=await d.path();
      record('Browser downloads the same authorized bytes',fs.readFileSync(file,'utf8')==='Original browser attachment');
    }
    if(app==='files'){
      await begin('Upload file');await form.locator('input[type=file]').setInputFiles({name:'browser-file.txt',mimeType:'text/plain',buffer:Buffer.from('Browser file version one')});await finish();
      const file=(await snapshot()).files.find(f=>f.name==='browser-file.txt');record('Files upload creates real versioned bytes',file.versions.length===1);
      await page.locator('[data-record-id="'+file.id+'"]').click();await begin('Download file');
      const download=page.waitForEvent('download');await finish();record('Files download returns original bytes',fs.readFileSync(await(await download).path(),'utf8')==='Browser file version one');
    }
    if(app==='mail'){await page.locator('[data-record-id="'+item.id+'"]').click();await operate('Send draft');record('GUI sends draft into local Sent',(await snapshot()).messages.find(m=>m.id===item.id).folder==='sent');}
    if(app==='calendar'){
      await operate('New event',{title:'Overlapping event',start:'2026-12-01T12:00',end:'2026-12-01T13:00',timezone:'America/Los_Angeles'});
      await begin('New event',{title:'Rejected overlap',start:'2026-12-01T12:30',end:'2026-12-01T13:30',timezone:'America/Los_Angeles'});
      await form.locator('button[type=submit]').click();await form.locator('[role=alert]').filter({hasText:/occupies|overlap/i}).waitFor();
      record('GUI reports business failure without partial event',!(await snapshot()).events.some(e=>e.title==='Rejected overlap'));await form.getByRole('button',{name:'Cancel',exact:true}).click();
      await page.locator('[data-record-id="'+item.id+'"]').click();await operate('Cancel event');record('GUI cancels the selected event',(await snapshot()).events.find(e=>e.id===item.id).status==='cancelled');
    }
    if(app==='tasks'){await operate('Change status',{status:'completed'});record('GUI completes a task',(await snapshot()).tasks.find(t=>t.id===item.id).status==='completed');}
    if(app==='contacts'){await operate('Archive or restore',{'patch.archived':true});record('GUI archives a contact',(await snapshot()).contacts.find(t=>t.id===item.id).archived);}
    if(app==='messages'){await page.locator('[data-record-id="'+item.id+'"]').click();await operate('Retract');record('GUI retracts a locally authored message',(await snapshot()).messages.find(t=>t.id===item.id).retracted);}
    // Product-level interactions, in addition to common form-to-MCP checks.
    if(app==='mail'){
      await page.locator('nav').getByRole('button',{name:/Inbox/}).click();await page.locator('[data-record-id=confirmation]').click();
      await page.getByRole('button',{name:'Reply',exact:true}).click();
      record('Reply opens a draft addressed to the visible sender',await form.locator('[data-field=to]').inputValue()==='alex.rivera@example.com'&&(await form.locator('[data-field=subject]').inputValue()).startsWith('Re: '));
      await form.getByRole('button',{name:'Cancel',exact:true}).click();
      await page.locator('[data-record-id=materials]').click();
      await page.getByRole('button',{name:'Download room.png',exact:true}).waitFor();
      await page.locator('.attachment-card').filter({hasText:'room.png'}).getByRole('button',{name:'Preview',exact:true}).click();
      await page.waitForFunction(()=>{const image=document.querySelector('dialog.media-preview img');return image?.complete&&image.naturalWidth>0;});
      record('Authorized image opens as an actual image preview',await page.locator('dialog.media-preview img').evaluate(e=>e.complete&&e.naturalWidth>0));
      await page.getByRole('button',{name:'Close preview',exact:true}).click();
      await page.locator('.attachment-card.unavailable').waitFor();
      record('Unavailable attachment has a readable fallback',await page.locator('.attachment-card.unavailable').count()===1);
    }
    if(app==='calendar'){
      const beforeMonth=await page.locator('.calendar-toolbar h3').textContent();await page.getByRole('button',{name:'Next month',exact:true}).click();
      record('Month navigation changes the visible calendar',await page.locator('.calendar-toolbar h3').textContent()!==beforeMonth);
      await page.locator('.calendar-day:not(.adjacent) button.day-number').first().click();
      record('Picking a calendar day prefills an event time',(await form.locator('[data-field=start]').inputValue()).includes('T09:00'));
      await form.getByRole('button',{name:'Cancel',exact:true}).click();
    }
    if(app==='files'){
      await page.locator('nav').getByRole('button',{name:/All files/}).click();await page.locator('[data-record-id=folder-receipts]').dblclick();
      await page.locator('.section-title').getByText('Receipts',{exact:true}).waitFor();await page.locator('#app[aria-busy=false]').waitFor();
      await page.locator('[data-record-id=file-receipt]').waitFor();
      record('Opening a folder shows its actual children',await page.locator('#records [data-record-id]').count()===1);
    }
    if(app==='messages'){
      const text=page.getByRole('textbox',{name:'Message to Household',exact:true});await text.fill('Sent through the conversation composer');
      await page.locator('.chat-composer').getByRole('button',{name:'Send',exact:true}).click();await page.locator('#app[aria-busy=false]').waitFor();
      record('In-thread composer saves to the selected conversation',(await snapshot()).messages.some(m=>m.text==='Sent through the conversation composer'&&m.conversation_id==='conversation-home'));
    }
    if(app==='notes'){
      await page.locator('nav').getByRole('button',{name:/Pinned/}).click();
      record('Pinned filter uses real note state',await page.locator('#records [data-record-id=note-groceries]').count()===1&&await page.locator('#records [data-record-id]').count()===1);
    }
    if(app==='tasks'){
      await page.locator('nav').getByRole('button',{name:/Completed/}).click();await page.getByRole('checkbox',{name:'Complete '+c.updated,exact:true}).uncheck();await page.locator('#app[aria-busy=false]').waitFor();
      record('Task checkbox updates actual completion status',(await snapshot()).tasks.find(t=>t.id===item.id).status==='todo');
    }
    if(app==='contacts'){
      await page.locator('nav').getByRole('button',{name:/Friends/}).click();
      record('Contact groups filter the address book',await page.locator('#records [data-record-id=contact-alex]').count()===1&&await page.locator('#records [data-record-id]').count()===1);
    }
    const event=JSON.parse(fs.readFileSync(path.join(appDir,'examples/scenario.json')));event.at='2026-11-18T10:00:00-08:00';
    if(event.payload.updated_at){event.payload.updated_at=event.at;event.payload.history.at(-1).at=event.at;}
    if(app==='mail')event.payload.received_at=event.at;
    const applied=await infra.call('env.apply_event',{expected_version:(await infra.call('env.snapshot')).version,event});
    record('Independent scenario event commits',applied.status==='committed');
    await page.getByRole('button',{name:'Refresh',exact:true}).click();await page.locator('#app[aria-busy=false]').waitFor();
    const section={mail:'Inbox',calendar:'All events',files:'All files',messages:'All conversations',notes:'All notes',tasks:'My tasks',contacts:'All contacts'}[app];
    await page.locator('nav').getByRole('button',{name:new RegExp(section)}).click();await page.locator('#app[aria-busy=false]').waitFor();await page.locator('[data-record-id="'+event.payload.id+'"]').click();
    await page.locator('.detail[data-selected-id="'+event.payload.id+'"]').waitFor();
    const key=app==='notes'?'body':app==='tasks'?'description':app==='contacts'?'organization':c.key;
    await page.waitForFunction(({key,value})=>document.querySelector('.detail').textContent.includes(value),{key,value:event.payload[key]});
    record('GUI refresh observes independent scenario state');
    const denial=await page.evaluate(async()=>{const {csrf}=await(await fetch('/session')).json();return(await fetch('/api/call',{method:'POST',headers:{'Content-Type':'application/json','X-Pale-CSRF':csrf},body:JSON.stringify({name:'env.snapshot',arguments:{}})})).status;});
    record('Direct management request from business session is denied',denial===403);
    record('No browser JavaScript errors',errors.length===0);
    await page.screenshot({path:path.join(out,app+'.png'),fullPage:true});
    await page.setViewportSize({width:390,height:844});
    record('Narrow viewport has no horizontal page overflow',await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    report.apps.push({app,package_sha256:digestTree(appDir),passed:true,checks});console.log(app+': '+checks.length+' GUI checks passed');
   }catch(e){report.apps.push({app,passed:false,checks,error:e.stack});console.error(app,e);if(page)await page.screenshot({path:path.join(out,app+'-failed.png'),fullPage:true}).catch(()=>{});}
   finally{await context?.close();await infra?.close();await host?.close();}
  }
  // A Task-like Calendar policy allows only start/end on one event.
  // Verify GUI patch construction respects that boundary instead of resending every visible field.
  let restricted,restrictedContext;
  try{
    restricted=await start({app:'calendar',stateDir,run:'restricted-browser',profile:'scenario'});
    restrictedContext=await browser.newContext();const p=await restrictedContext.newPage();p.setDefaultTimeout(7000);
    await p.goto(restricted.accessUrl);await p.locator('#records .record').first().waitFor();await p.locator('#app[aria-busy=false]').waitFor();
    assert.equal(await p.getByRole('button',{name:'New event',exact:true}).count(),0);
    await p.locator('[data-record-id=evt-review]').click();await p.getByRole('button',{name:'Edit event',exact:true}).click();
    await p.locator('[data-field="patch.start"]').fill('2026-12-03T10:00');await p.locator('[data-field="patch.end"]').fill('2026-12-03T11:00');
    await p.locator('dialog button[type=submit]').click();await p.locator('dialog').waitFor({state:'hidden'});
    const event=(await restricted.client.call('calendar.get',{id:'evt-review'})).event;
    assert.ok(event.start.startsWith('2026-12-03'));assert.equal(event.title,'Design review');
    report.restricted_gui={passed:true,checks:['Undiscovered create control is absent','GUI sends only permitted edited time fields','Original title and participants are not overwritten']};
  }catch(e){report.restricted_gui={passed:false,error:e.stack};console.error('restricted GUI',e);}
  finally{await restrictedContext?.close();await restricted?.close();}
  report.passed=report.apps.every(x=>x.passed)&&report.restricted_gui.passed;
 }finally{await browser.close();fs.rmSync(stateDir,{recursive:true,force:true});fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2)+'\n');}
 if(!report.passed)process.exitCode=1;
})().catch(e=>{console.error(e);process.exitCode=1;});
