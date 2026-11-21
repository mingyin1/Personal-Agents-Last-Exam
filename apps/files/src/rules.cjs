'use strict';
const {fail} = require('./common.cjs');
function validate(ctx, data) {
  const files = new Map(data.files.map(f => [f.id, f]));
  const names = new Set();
  for (const file of data.files) {
    if (!file.name.trim() || ['.','..'].includes(file.name)) fail('invalid_seed', 'Invalid file name.');
    if (file.kind === 'folder' ? file.versions.length !== 0 : file.versions.length === 0) {
      fail('invalid_seed', 'Files need at least one version; folders have no bytes.');
    }
    let previous = Date.parse(file.created_at);
    file.versions.forEach((v,i) => {
      if (v.number !== i+1 || Date.parse(v.at) < previous || Date.parse(v.at) > Date.parse(file.updated_at)) {
        fail('invalid_seed', 'File versions must be contiguous and chronological.');
      }
      previous = Date.parse(v.at);
    });
    const ancestors = new Set([file.id]);
    let parent = file.parent_id;
    while (parent !== null) {
      if (ancestors.has(parent)) fail('invalid_seed', 'Folders cannot form a cycle.');
      ancestors.add(parent);
      const folder = files.get(parent);
      if (!folder || folder.kind !== 'folder') fail('invalid_seed', 'Parent must be an existing folder.');
      if (!file.trashed && folder.trashed) fail('invalid_seed', 'Active records cannot be inside a trashed folder.');
      parent = folder.parent_id;
    }
    if (!file.trashed) {
      const key = JSON.stringify([file.parent_id,file.name]);
      if (names.has(key)) fail('already_exists', 'An active sibling already uses this name.');
      names.add(key);
    }
  }
}
module.exports = {validate};
