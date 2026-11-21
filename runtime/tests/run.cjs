#!/usr/bin/env node
'use strict';
const fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'../..'),reportDir=path.resolve(process.env.PALE_REPORT_DIR||path.join(root,'.artifacts'));
fs.mkdirSync(reportDir,{recursive:true});
const entries=[
 ['contracts',['runtime/build-contracts.cjs','--check']],
 ['contract-rules',['runtime/contracts/tests.cjs']],
 ['loader-and-compatibility',['--test','runtime/tests/loader.test.cjs']],
 ['extensibility',['--test','runtime/tests/extensibility.test.cjs']],
 ['clock-contract',['--test','runtime/tests/clock.test.cjs']],
 ['session-time',['examples/workflows/session-time/run.cjs',path.join(reportDir,'session-time.json')]],
 ['mail-public-verification',['runtime/cli.cjs','verify','--app','examples/apps/mail','--output',path.join(reportDir,'mail.json')]],
 ['calendar-public-verification',['runtime/cli.cjs','verify','--app','examples/apps/calendar','--output',path.join(reportDir,'calendar.json')]],
 ['core-business-and-mcp',['runtime/tests/core-behavior.cjs']],
 ['assets',['runtime/tests/assets.cjs']],
 ['platform-access',['runtime/tests/platform-access.cjs']],
 ['app-diagnostics',['runtime/tests/app-logging.cjs']],
 ['messaging-directions',['runtime/messaging/tests/test_contract.cjs']],
 ['messaging-delivery',['runtime/messaging/tests/test_messaging.cjs']],
 ['time-tracing',['runtime/messaging/tests/test_time_trace.cjs',path.join(reportDir,'time-trace.json')]],
 ['mail-to-mail',['runtime/tests/mail-to-mail.cjs']],
 ['delivery-to-mail',['examples/workflows/delivery-to-mail/run.cjs']],
 ['non-mail-route',['runtime/tests/non-mail-routing.cjs']],
 ['attachment-safety',['runtime/tests/attachments.cjs']],
 ['attachment-workflow',['examples/workflows/attachments/run.cjs']],
 ['personal-apps',['runtime/tests/personal-apps.cjs']],
 ['business-web-host',['--test','runtime/web/host.test.cjs']]
];
const stages=[];
for(const [name,args]of entries){
 const start=Date.now(),r=spawnSync(process.execPath,args,{cwd:root,encoding:'utf8',timeout:90000,maxBuffer:8*1024*1024});
 fs.writeFileSync(path.join(reportDir,name+'.log'),(r.stdout||'')+(r.stderr||''));
 const stage={name,status:r.status===0?'passed':'failed',command:['node',...args],duration_ms:Date.now()-start,exit_code:r.status,log:name+'.log'};
 if(r.error)stage.error=r.error.message;stages.push(stage);console.log(stage.status.toUpperCase()+': '+name);
 if(r.status!==0)process.stderr.write((r.stderr||r.stdout||String(r.error)).slice(-5000));
}
const report={schema:'pale.public-runtime-verification.v1',runtime_version:require('../package.json').version,core_api_version:'1.2.0',node:process.version,verified_at:new Date().toISOString(),passed:stages.every(s=>s.status==='passed'),stages,scope:'Public local reference runtime. No private host, credentials, model API or remote service used. Manual workflow/provenance and production deployment review remain separate.'};
fs.writeFileSync(path.join(reportDir,'summary.json'),JSON.stringify(report,null,2)+'\n');
console.log(`${stages.filter(s=>s.status==='passed').length}/${stages.length} stages passed. Report: ${path.relative(root,reportDir)}/summary.json`);
if(!report.passed)process.exitCode=1;
