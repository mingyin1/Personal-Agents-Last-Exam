'use strict';
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'../..');
const {baseline:admin}=require('../core/admin-tools.cjs');
// Offline packages keep generated copies. Authors edit only these canonical sources.
function packages(){
 const result=[];
 for(const dir of ['apps','examples/apps','runtime/tests/fixtures/non-mail']){
  const base=path.join(root,dir);if(!fs.existsSync(base))continue;
  for(const item of fs.readdirSync(base)){
   const folder=path.join(base,item);
   if(fs.existsSync(path.join(folder,'app.json')))result.push(folder);
  }
 }
 return result;
}
function sync({check=false}={}){
 const copy=(source,target)=>{
  const expected=fs.readFileSync(source);
  if(check){if(!fs.existsSync(target)||!fs.readFileSync(target).equals(expected))throw Error('Generated copy drift: '+path.relative(root,target));}
  else fs.writeFileSync(target,expected);
 };
 const common=['asset-catalog','asset-descriptor','attachment-transfer','bundle','dataset','quality','resources'];
 const canonical=name=>path.join(root,'runtime/contracts/schemas',name+'.schema.json');
 const core=path.join(root,'runtime/core/schemas');
 for(const name of [...common,'binding','policies','tools'])copy(canonical(name),path.join(core,name+'.schema.json'));
 copy(canonical('app-manifest'),path.join(core,'app.schema.json'));
 for(const dir of packages()){
  for(const name of common){const target=path.join(dir,'schemas',name+'.schema.json');if(fs.existsSync(target))copy(canonical(name),target);}
  // Tiny helper templates are vendored so App-only tests have no host dependency.
  for(const [name,target] of [['domain-utils.cjs','src/domain-utils.cjs'],['diagnostics.cjs','src/diagnostics.cjs'],['harness.cjs','tests/harness.cjs']]){
   const file=path.join(dir,target);
   // Only opt-in reference packages use these exact helpers; domain helpers remain App-owned.
   if(['mail','calendar'].includes(path.basename(dir))&&dir.startsWith(path.join(root,'examples/apps')))copy(path.join(__dirname,'templates',name),file);
  }
  const manifest=JSON.parse(fs.readFileSync(path.join(dir,'app.json'))),file=path.join(dir,manifest.contribution);
  const c=JSON.parse(fs.readFileSync(file)),expected=structuredClone(c),tools=JSON.parse(fs.readFileSync(path.join(dir,manifest.tools)));
  expected.dependencies.core_api=manifest.core_api_version;
  expected.dependencies.required_apps=manifest.dependencies.map(x=>x.app_id);
  for(const surface of expected.interfaces){
   if(surface.status!=='implemented'||surface.audience.length!==1)continue;
   const role=surface.audience[0];
   if(role==='agent')surface.operations=tools.map(t=>({name:t.name,effect:t.read_only?'read':'write',caller:'agent'}));
   // Keep portable App declarations unchanged; discover host clock support via tools/list.
   if(role==='infra')surface.operations=admin.map(name=>({name,effect:'admin',caller:'infra'}));
  }
  if(check){if(JSON.stringify(c)!==JSON.stringify(expected))throw Error('Derived contribution fields drift: '+path.relative(root,file));}
  else fs.writeFileSync(file,JSON.stringify(expected,null,2)+'\n');
 }
}
module.exports={sync,packages};
if(require.main===module){sync({check:process.argv.includes('--check')});console.log('Shared schemas, reference helpers and derived declarations match.');}
