'use strict';
const {APP, TYPE, references, fail} = require('./common.cjs');
const rules = require('./rules.cjs');
function validateSeed(ctx, data) {
  references(ctx, data);
  const seen = new Set();
  for (const item of data[APP]) {
    if (seen.has(item.id) || item.account_id !== data.account_id) fail('invalid_seed', 'Duplicate ID or wrong record account.');
    seen.add(item.id);
    if (Date.parse(item.created_at) > Date.parse(item.updated_at)) fail('invalid_seed', 'Record timestamps are reversed.');
    let previous = Date.parse(item.created_at);
    for (const entry of item.history) {
      const at = Date.parse(entry.at);
      if (!Number.isFinite(at) || at < previous || at > Date.parse(item.updated_at)) fail('invalid_seed', 'Invalid history timeline.');
      previous = at;
    }
    if (!item.history.length || previous !== Date.parse(item.updated_at)) fail('invalid_seed', 'History must include the last update.');
  }
  rules.validate(ctx, data);
}
function assetReferences(data) {
  return data[APP].flatMap(item => {
    const ids = APP === 'files' ? item.versions.map(v => v.asset_id) : (item.attachments || []);
    return [...new Set(ids)].map(asset_id => ({asset_id, object_id:item.id, object_type:TYPE}));
  });
}
module.exports = {validateSeed, records:data=>data[APP], objects:data=>data[APP].map(r=>r.id), references:()=>[], assetReferences};
