'use strict';
// App-owned domain utilities. No persistence, authentication or platform runtime.
const fail=(code,message)=>{const error=new Error(message);error.code=code;throw error;};
const copy=value=>structuredClone(value);
const text=(value,max=10000)=>typeof value==='string'&&value.trim().length>0&&value.length<=max;
const range=value=>Number.isFinite(Date.parse(value.start))&&Number.isFinite(Date.parse(value.end))&&Date.parse(value.start)<Date.parse(value.end);
const overlap=(a,b)=>Date.parse(a.start)<Date.parse(b.end)&&Date.parse(b.start)<Date.parse(a.end);
function references(ctx,data){
 const person=ctx.binding.people.some(p=>p.person_id===data.owner_person_id);
 const account=ctx.binding.accounts.some(a=>a.app_id===ctx.app_id&&a.account_id===data.account_id&&a.owner_person_id===data.owner_person_id);
 if(!person||!account)fail('invalid_seed','Account and owner must exist in the supplied binding.');
}
module.exports={fail,copy,text,range,overlap,references};
