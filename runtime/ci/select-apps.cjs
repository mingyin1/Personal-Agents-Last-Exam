'use strict';
const fs=require('node:fs'),path=require('node:path'),{execFileSync}=require('node:child_process');
function discover(root){
 const apps=new Map();
 for(const folder of ['examples/apps','apps']){
  const dir=path.join(root,folder);if(!fs.existsSync(dir))continue;
  for(const name of fs.readdirSync(dir)){
   const location=path.join(dir,name),file=path.join(location,'app.json');if(!fs.existsSync(file))continue;
   const manifest=JSON.parse(fs.readFileSync(file));
   if(apps.has(manifest.app_id))throw Error('Duplicate App ID across submission directories');
   apps.set(manifest.app_id,{location,relative:folder+'/'+name,manifest});
  }
 }
 return apps;
}
function select(apps,paths){
 const full=paths===null||paths.some(p=>/^(runtime\/|examples\/|package[^/]*\.json$|apps\.registry\.json$|\.github\/workflows\/app-validation\.yml$)/.test(p));
 if(full)return {full:true,ids:[...apps.keys()].sort()};
 const ids=new Set();
 for(const [id,app]of apps)if(paths.some(p=>p.startsWith(app.relative+'/')))ids.add(id);
 let added=true;
 while(added){added=false;for(const [id,app]of apps)if(!ids.has(id)&&app.manifest.dependencies.some(d=>ids.has(d.app_id))){ids.add(id);added=true;}}
 return {full:false,ids:[...ids].sort()};
}
function changed(root,base){
 if(!base||/^0+$/.test(base))return null;
 if(!/^[a-f0-9]{7,40}$/.test(base))throw Error('CI base must be a commit SHA');
 return execFileSync('git',['diff','--name-only',base+'...HEAD','--'],{cwd:root,encoding:'utf8'}).trim().split('\n').filter(Boolean);
}
function selection(root,base){return select(discover(root),changed(root,base));}
module.exports={discover,select,selection};
if(require.main===module){
 const result=selection(path.resolve(process.argv[2]||'.'),process.argv[3]);
 console.log(JSON.stringify(result));
 if(process.env.GITHUB_OUTPUT)fs.appendFileSync(process.env.GITHUB_OUTPUT,'full='+result.full+'\n');
}
