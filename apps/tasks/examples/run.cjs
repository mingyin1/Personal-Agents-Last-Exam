'use strict';
const assert = require('node:assert/strict');
const {fixture} = require('../tests/harness.cjs');
const f = fixture();
const before = f.data;
f.event(require('./scenario.json'));
assert.notDeepEqual(f.data, before);
console.log(JSON.stringify({app: 'tasks', before, after: f.data}, null, 2));
