'use strict';
// Explicit JSON Schema 2020-12 subset. Unsupported keywords fail at registration.
const fs=require('node:fs'),path=require('node:path');
const keywords=new Set(['$schema','$id','$ref','$defs','title','description','default','examples','type','properties','required','additionalProperties','items','minItems','maxItems','uniqueItems','minLength','maxLength','pattern','minimum','maximum','enum','const','anyOf','oneOf','format']);
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
function compile(schema,base){
 const boundary=fs.realpathSync(base),cache=new Map();
 function ref(key,doc,dir){
  const [file,fragment]=key.split('#');let target=doc,next=dir;
  if(file){if(/^[a-z]+:/i.test(file)||path.isAbsolute(file))throw new Error('Remote / absolute schema refs are unsupported');
   const f=fs.realpathSync(path.resolve(dir,file));if(f!==boundary&&!f.startsWith(boundary+path.sep))throw new Error('Schema ref escapes package');
   if(!cache.has(f))cache.set(f,JSON.parse(fs.readFileSync(f,'utf8')));target=cache.get(f);next=path.dirname(f);}
  const root=target;
  if(fragment){if(!fragment.startsWith('/'))throw new Error('Only JSON Pointer refs supported');for(const part of fragment.slice(1).split('/'))target=target?.[part.replace(/~1/g,'/').replace(/~0/g,'~')];}
  if(target===undefined)throw new Error('Unknown schema ref '+key);return [target,root,next];
 }
 const seen=new Set();
 function inspect(s,doc=s,dir=boundary){
  if(typeof s==='boolean')return;if(!object(s))throw new Error('Invalid schema');if(seen.has(s))return;seen.add(s);
  for(const k of Object.keys(s))if(!keywords.has(k))throw new Error('Unsupported JSON Schema keyword '+k);
  if(s.properties!==undefined&&!object(s.properties)||s.$defs!==undefined&&!object(s.$defs))throw new Error('Schema properties / definitions must be objects');
  if(s.required!==undefined&&(!Array.isArray(s.required)||!s.required.every(x=>typeof x==='string')||new Set(s.required).size!==s.required.length))throw new Error('Invalid required keyword');
  if(s.enum!==undefined&&(!Array.isArray(s.enum)||!s.enum.length))throw new Error('Invalid enum');
  for(const k of ['minItems','maxItems','minLength','maxLength'])if(s[k]!==undefined&&(!Number.isInteger(s[k])||s[k]<0))throw new Error('Invalid schema bound '+k);
  for(const k of ['minimum','maximum'])if(s[k]!==undefined&&(typeof s[k]!=='number'||!Number.isFinite(s[k])))throw new Error('Invalid numeric bound');
  for(const k of ['anyOf','oneOf'])if(s[k]!==undefined&&(!Array.isArray(s[k])||!s[k].length))throw new Error('Invalid schema alternatives');
  if(s.$ref!==undefined&&typeof s.$ref!=='string'||s.pattern!==undefined&&typeof s.pattern!=='string'||s.uniqueItems!==undefined&&typeof s.uniqueItems!=='boolean')throw new Error('Invalid schema keyword value');
  if(s.additionalProperties!==undefined&&typeof s.additionalProperties!=='boolean'&&!object(s.additionalProperties))throw new Error('Invalid additionalProperties');
  if(s.format&&s.format!=='date-time')throw new Error('Unsupported format '+s.format);
  if(s.type&&!['object','array','string','integer','number','boolean','null'].includes(s.type))throw new Error('Unsupported schema type');
  if(s.pattern)new RegExp(s.pattern);
  if(s.$ref)inspect(...ref(s.$ref,doc,dir));
  for(const v of Object.values(s.properties||{}))inspect(v,doc,dir);
  for(const v of Object.values(s.$defs||{}))inspect(v,doc,dir);
  if(s.items!==undefined)inspect(s.items,doc,dir);if(object(s.additionalProperties))inspect(s.additionalProperties,doc,dir);
  for(const k of ['anyOf','oneOf'])for(const v of s[k]||[])inspect(v,doc,dir);
 }
 function date(v){const m=v.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|[+-]\d{2}:\d{2})$/);return !!m&&+m[2]>=1&&+m[2]<=12&&+m[3]>=1&&+m[3]<=new Date(Date.UTC(+m[1],+m[2],0)).getUTCDate()&&+m[4]<24&&+m[5]<60&&+m[6]<60&&Number.isFinite(Date.parse(v));}
 function valid(v,s,doc=s,dir=boundary,depth=0){
  if(depth>80)return false;if(typeof s==='boolean')return s;
  if(s.$ref&&!valid(v,...ref(s.$ref,doc,dir),depth+1))return false;
  if(s.enum&&!s.enum.some(x=>JSON.stringify(x)===JSON.stringify(v)))return false;
  if(Object.hasOwn(s,'const')&&JSON.stringify(v)!==JSON.stringify(s.const))return false;
  if(s.anyOf&&!s.anyOf.some(t=>valid(v,t,doc,dir,depth+1)))return false;
  if(s.oneOf&&s.oneOf.filter(t=>valid(v,t,doc,dir,depth+1)).length!==1)return false;
  if(s.type&&!({object:object(v),array:Array.isArray(v),string:typeof v==='string',integer:Number.isInteger(v),number:typeof v==='number'&&Number.isFinite(v),boolean:typeof v==='boolean',null:v===null})[s.type])return false;
  if(object(v)){
   if((s.required||[]).some(k=>!Object.hasOwn(v,k)))return false;
   for(const [k,x] of Object.entries(v)){if(Object.hasOwn(s.properties||{},k)){if(!valid(x,s.properties[k],doc,dir,depth+1))return false;}
    else if(s.additionalProperties===false)return false;else if(object(s.additionalProperties)&&!valid(x,s.additionalProperties,doc,dir,depth+1))return false;}
  }
  if(Array.isArray(v)){if(s.minItems!==undefined&&v.length<s.minItems||s.maxItems!==undefined&&v.length>s.maxItems)return false;if(s.uniqueItems&&new Set(v.map(x=>JSON.stringify(x))).size!==v.length)return false;if(s.items&&!v.every(x=>valid(x,s.items,doc,dir,depth+1)))return false;}
  if(typeof v==='string'){if(s.minLength!==undefined&&v.length<s.minLength||s.maxLength!==undefined&&v.length>s.maxLength)return false;if(s.pattern&&!new RegExp(s.pattern).test(v))return false;if(s.format==='date-time'&&!date(v))return false;}
  if(typeof v==='number'&&(s.minimum!==undefined&&v<s.minimum||s.maximum!==undefined&&v>s.maximum))return false;
  return true;
 }
 inspect(schema);return value=>valid(value,schema);
}
module.exports={compile};
