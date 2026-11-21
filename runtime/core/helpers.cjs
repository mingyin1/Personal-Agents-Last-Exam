'use strict';
const copy=x=>JSON.parse(JSON.stringify(x));
const version=s=>({epoch:s.epoch,revision:s.revision});
const fail=(code,message)=>{throw Object.assign(new Error(message),{code});};
const range=e=>Number.isFinite(Date.parse(e.start))&&Number.isFinite(Date.parse(e.end))&&Date.parse(e.start)<Date.parse(e.end);
const overlap=(a,b)=>Date.parse(a.start)<Date.parse(b.end)&&Date.parse(b.start)<Date.parse(a.end);
const text=(v,max=10000)=>typeof v==='string'&&v.trim().length>0&&v.length<=max;
const freeze=o=>{if(o&&typeof o==='object'){Object.freeze(o);for(const v of Object.values(o))freeze(v);}return o;};
function references(ctx,data){
 if(!ctx.binding.people.some(p=>p.person_id===data.owner_person_id)||!ctx.binding.accounts.some(a=>a.app_id===ctx.app_id&&a.account_id===data.account_id&&a.owner_person_id===data.owner_person_id))fail('invalid_seed','Accounts and people must be declared in the trusted binding.');
}
module.exports={copy,version,fail,range,overlap,text,freeze,references};
