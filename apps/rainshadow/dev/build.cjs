#!/usr/bin/env node
'use strict';
// Authoring-time generator, never run by the App or the host.
//   node dev/build.cjs          write tools.json and the App-owned schemas
//   node dev/build.cjs --check  exit 1 if a generated file differs from dev/contracts.cjs
// The Core state envelope is taken from the provided template in the public checkout
// when it is available; otherwise the committed copy is only re-stamped.
const fs = require('node:fs'), path = require('node:path');
const contracts = require('./contracts.cjs');
const root = path.resolve(__dirname, '..');
const json = value => JSON.stringify(value, null, 2) + '\n';

function stateTemplate() {
  const provided = path.resolve(root, '../../runtime/tests/fixtures/non-mail/noticebox/schemas/state.schema.json');
  const file = fs.existsSync(provided) ? provided : path.join(root, 'schemas/state.schema.json');
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function outputs() {
  return {
    'tools.json': json(contracts.toolsJson()),
    'schemas/seed.schema.json': json(contracts.seed),
    'schemas/events.schema.json': json(contracts.events),
    'schemas/state.schema.json': json(contracts.stateSchema(stateTemplate())),
  };
}

function main() {
  const check = process.argv.includes('--check');
  let drift = 0;
  for (const [ref, text] of Object.entries(outputs())) {
    const file = path.join(root, ref);
    if (check) {
      if (!fs.existsSync(file) || fs.readFileSync(file, 'utf8') !== text) { console.error('Generated file drift: ' + ref); drift++; }
    } else fs.writeFileSync(file, text);
  }
  if (drift) process.exit(1);
  console.log(check ? 'Generated contracts match dev/contracts.cjs.' : 'Wrote tools.json and schemas.');
}

module.exports = { outputs };
if (require.main === module) main();
