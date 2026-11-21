'use strict';
const c = require('./common.cjs');
const {APP, find, active, patch, stamp, create, fail, copy} = c;
function handleTool(ctx, data, name, args) {
  const read = c.read(ctx, data, name, args);
  if (read) return {data, result:read};
  const attached = c.attachment(ctx, data, name, args);
  if (attached) return {data, result:attached};
  const action = name.slice(APP.length + 1);
  let item;
  if (action === 'create') {
    const defaults = {title:'', body:'', tags:[], pinned:false, archived:false, trashed:false, attachments:[], revisions:[]};
    const {expected_version, request_id, ...fields} = args;
    item = create(ctx, data, {...defaults, ...copy(fields)});
  } else if (action === 'update' || action === 'flags') {
    item = find(data,args.id);
    if(action==='update') active(item);
    if(APP==='notes' && action==='update' && ('title' in args.patch || 'body' in args.patch)) {
      item.revisions.push({at:item.updated_at,title:item.title,body:item.body});
    }
    patch(item,args.patch);stamp(ctx,item,action);
  } else fail('unknown_tool','Unknown business operation.');
  return {data,result:{id:item.id}};
}
module.exports={handleTool};
