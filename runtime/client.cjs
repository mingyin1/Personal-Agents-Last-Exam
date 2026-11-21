'use strict';
const {spawn}=require('node:child_process'),path=require('node:path'),readline=require('node:readline');
class Client{
 constructor(app,role,run,stateDir,clientName='pale-local-driver',options={}){
  this.clientName=clientName;this.closed=false;
  this.seq=0;this.pending=new Map();this.errors='';
  this.child=spawn(process.execPath,options.commandArgs||[options.service||path.join(__dirname,'mcp-server.cjs'),'--app',app,'--role',role,'--run',run,'--state-dir',stateDir,...(options.registry?['--registry',options.registry]:[]),...(options.assembly?['--assembly',options.assembly]:[]),...(options.initialProfile?['--initial-profile',options.initialProfile]:[])],{stdio:['pipe','pipe','pipe']});
  this.child.stderr.on('data',b=>{this.errors+=b;});
  readline.createInterface({input:this.child.stdout}).on('line',line=>{const m=JSON.parse(line),p=this.pending.get(m.id);if(!p&&m.id===null&&m.error){for(const item of this.pending.values()){clearTimeout(item.timer);item.reject(new Error('MCP transport error: '+m.error.message));}this.pending.clear();return;}if(p){clearTimeout(p.timer);this.pending.delete(m.id);p.resolve(m);}});
  const fail=()=>{this.closed=true;for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(new Error('Server exited: '+this.errors));}this.pending.clear();};
  this.child.on('exit',fail);this.child.on('error',e=>{this.errors+=e.message;fail();});
 }
 request(method,params={}){return new Promise((resolve,reject)=>{if(this.closed)return reject(new Error('MCP process is unavailable'));const id=++this.seq;const timer=setTimeout(()=>{this.pending.delete(id);reject(new Error('MCP request timed out: '+method));},6000);this.pending.set(id,{resolve,reject,timer});this.child.stdin.write(JSON.stringify({jsonrpc:'2.0',id,method,params})+'\n',e=>{if(e){clearTimeout(timer);this.pending.delete(id);reject(e);}});});}
 notify(method,params={}){this.child.stdin.write(JSON.stringify({jsonrpc:'2.0',method,params})+'\n');}
 async initialize(){const r=await this.request('initialize',{protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:this.clientName,version:'0.2.0'}});if(r.error)throw new Error(JSON.stringify(r.error));this.notify('notifications/initialized');return r.result;}
 async call(name,args={}){const r=await this.request('tools/call',{name,arguments:args});if(r.error)throw new Error(JSON.stringify(r.error));return r.result.structuredContent;}
 async close(){if(this.closed||this.child.exitCode!==null)return;const done=new Promise(resolve=>this.child.once('exit',resolve));this.child.stdin.end();const timer=setTimeout(()=>this.child.kill('SIGTERM'),1000);await done;clearTimeout(timer);}
}
module.exports={Client};
