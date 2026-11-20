'use strict';
// Stable App entrypoint for the host. All business behavior lives under src/.
const { validateSeed, records, objects, references } = require('./src/model.cjs');
const { handleTool } = require('./src/operations.cjs');
const { applyEvent } = require('./src/events.cjs');
module.exports = { validateSeed, records, objects, references, handleTool, applyEvent };
