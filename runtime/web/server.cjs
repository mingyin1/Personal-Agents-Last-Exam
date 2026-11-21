'use strict';
const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {Client}=require('../client.cjs');
const {createRuntime}=require('../core/runtime.cjs');
const root=path.resolve(__dirname,'../..');
async function start({app,registry=path.join(root,'apps.registry.json'),run='web-demo',stateDir=path.join(root,'.state'),profile='sandbox',port=0}={}){
  if(!/^[a-z][a-z0-9-]*$/.test(app||'') || !/^[-a-zA-Z0-9_]{1,80}$/.test(run))throw Error('Invalid App/run');
  if(!['sandbox','scenario'].includes(profile))throw Error('Choose sandbox or scenario');
  registry=path.resolve(registry);stateDir=path.resolve(stateDir);
  const pkg=createRuntime({registryFile:registry}).get(app);
  const gui=JSON.parse(fs.readFileSync(path.join(pkg.dir,'contribution/gui.json')));
  const web=gui.extensions.find(e=>e.namespace==='pale.web'&&e.version==='1')?.data;
  if(!web)throw Error('App has no public web controller');
  function inside(relative){const f=path.resolve(pkg.dir,relative);if(!f.startsWith(pkg.dir+path.sep)||!fs.realpathSync(f).startsWith(fs.realpathSync(pkg.dir)+path.sep))throw Error('Invalid App web path');return f;}
  const page=inside(web.page),controller=inside(web.controller);
  // Core initializes the selected policy atomically with first state creation.
  // No separate web lock or subsequent reset can strand or overwrite a run.
  const infra=new Client(app,'infra',run,stateDir,'pale-web-initializer',{registry,initialProfile:profile});
  try{
    await infra.initialize();
  }finally{await infra.close();}
  const client=new Client(app,'agent',run,stateDir,'pale-business-web',{registry});
  await client.initialize();
  const token=crypto.randomBytes(32).toString('hex'),cookie=crypto.randomBytes(32).toString('hex'),csrf=crypto.randomBytes(32).toString('hex');
  const cookieName='pale_'+crypto.randomBytes(8).toString('hex');
  let origin;
  const json=(res,status,value)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(value));};
  async function body(req){let size=0,parts=[];for await(const chunk of req){size+=chunk.length;if(size>2*1024*1024)throw Error('Request too large');parts.push(chunk);}return JSON.parse(Buffer.concat(parts).toString('utf8'));}
  const server=http.createServer(async(req,res)=>{
    res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' blob:; media-src blob:; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    try{
      if(req.headers.host!==new URL(origin).host)return json(res,403,{error:'Invalid Host'});
      const u=new URL(req.url,origin);
      if(u.search || (req.headers.origin&&req.headers.origin!==origin))return json(res,403,{error:'Origin not allowed'});
      if(req.method==='POST'&&(req.headers.origin!==origin||!String(req.headers['content-type']||'').startsWith('application/json')))return json(res,403,{error:'Same-origin JSON required'});
      const authenticated=String(req.headers.cookie||'').split(';').some(x=>x.trim()===cookieName+'='+cookie);
      if(req.method==='POST'&&u.pathname==='/session'){
        const p=await body(req);
        if(p.token!==token)return json(res,403,{error:'Open the access link printed by the Host'});
        res.setHeader('Set-Cookie',cookieName+'='+cookie+'; HttpOnly; SameSite=Strict; Path=/');
        return json(res,200,{csrf});
      }
      if(req.method==='GET'&&u.pathname==='/session'){
        if(!authenticated)return json(res,401,{error:'Open the access link printed by the Host'});
        return json(res,200,{csrf});
      }
      const staticFiles={'/':[page,'text/html'],'/app.js':[controller,'text/javascript'],'/shared/client.js':[path.join(__dirname,'client.js'),'text/javascript'],'/shared/style.css':[path.join(__dirname,'style.css'),'text/css']};
      if(req.method==='GET'&&staticFiles[u.pathname]){
        const [file,type]=staticFiles[u.pathname];res.writeHead(200,{'Content-Type':type+'; charset=utf-8','Cache-Control':'no-store'});return res.end(fs.readFileSync(file));
      }
      if(!authenticated)return json(res,401,{error:'Access link required'});
      if(req.method==='GET'&&u.pathname==='/api/tools'){
        const r=await client.request('tools/list');if(r.error)throw Error('Tool discovery failed');
        return json(res,200,{app,run,tools:r.result.tools});
      }
      if(req.method==='POST'&&u.pathname==='/api/call'){
        if(req.headers['x-pale-csrf']!==csrf)return json(res,403,{error:'Invalid request token'});
        const p=await body(req);
        if(!p||Object.keys(p).some(k=>!['name','arguments'].includes(k))||typeof p.name!=='string'||!p.arguments||Array.isArray(p.arguments)||typeof p.arguments!=='object')return json(res,400,{error:'Invalid business request'});
        const r=await client.request('tools/list');
        if(!r.result?.tools.some(t=>t.name===p.name))return json(res,403,{error:'Business operation not permitted'});
        return json(res,200,await client.call(p.name,p.arguments));
      }
      return json(res,404,{error:'Not found'});
    }catch(e){return json(res,400,{error:e.message});}
  });
  try{await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',()=>{origin='http://127.0.0.1:'+server.address().port;resolve();});});}
  catch(e){await client.close();throw e;}
  return {url:origin,accessUrl:origin+'/#access='+token,app,run,stateDir,registry,client,
    async close(){await new Promise(resolve=>{server.close(resolve);server.closeAllConnections?.();});await client.close();}};
}
if(require.main===module){
  const args={};for(let i=2;i<process.argv.length;i+=2){const k=process.argv[i],v=process.argv[i+1];if(!['--app','--registry','--run','--state-dir','--profile','--port'].includes(k)||!v)throw Error('Usage: --app APP [--registry FILE --run RUN --state-dir DIR --profile sandbox|scenario --port PORT]');args[k.slice(2)==='state-dir'?'stateDir':k.slice(2)]=k==='--port'?Number(v):v;}
  start(args).then(host=>{console.log('Open '+host.accessUrl);console.log('Business interface only; run '+host.run+'. Management remains separate MCP.');for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>host.close().then(()=>process.exit(0)));}).catch(e=>{console.error(e);process.exitCode=1;});
}
module.exports={start};
