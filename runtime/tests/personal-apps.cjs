'use strict';
const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const {verify}=require('../verify.cjs');
const root=path.resolve(__dirname,'../..');
const out=path.resolve(process.env.PALE_REPORT_DIR || path.join(root,'.artifacts/personal-apps'));
(async()=>{
  fs.mkdirSync(out,{recursive:true});
  const reports=[];
  for(const app of ['files','messages','notes','tasks','contacts']) {
    assert.ok(fs.readFileSync(path.join(root,'apps',app,'tests/schema-validator.cjs'))
      .equals(fs.readFileSync(path.join(root,'runtime/contracts/schema-validator.cjs'))),app+': vendored public schema validator matches');
    const report=await verify(path.join(root,'apps',app));
    reports.push(report);
    fs.writeFileSync(path.join(out,app+'.json'),JSON.stringify(report,null,2)+'\n');
    console.log(app+': '+(report.passed?'PASS':'FAIL')+' ('+report.checks.length+' checks)');
    if(!report.passed) console.error(report.error || report.stages.filter(s=>s.status!=='passed'));
  }
  assert.ok(reports.every(r=>r.passed),'All isolated App and public MCP checks must pass');
  const workflows=await require('../../examples/workflows/personal-apps/run.cjs').run();
  fs.writeFileSync(path.join(out,'workflows.json'),JSON.stringify(workflows,null,2)+'\n');
  console.log('Cross-App workflows: '+workflows.checks.length+' checks passed');
})().catch(error=>{console.error(error);process.exitCode=1;});
