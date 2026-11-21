'use strict';
const c = require('./common.cjs');
const transitions = {
  tentative:['todo','cancelled'], todo:['in_progress','completed','cancelled'],
  in_progress:['todo','completed','cancelled'], completed:['todo'], cancelled:['todo']
};
function handleTool(ctx, data, name, args) {
  const read = c.read(ctx, data, name, args);
  if (read) return {data, result:read};
  let item;
  if (name === 'tasks.create') {
    const {expected_version, request_id, ...fields} = args;
    item = c.create(ctx, data, {title:'', description:'', list:'Personal',
      assignee_person_id:data.owner_person_id, due_at:null, priority:0, tags:[], blocked_by:[],
      status:'todo', completed_at:null, ...c.copy(fields)});
  } else if (name === 'tasks.update') {
    item = c.find(data, args.id);
    if (['completed','cancelled'].includes(item.status)) c.fail('invalid_state', 'Reopen the task before editing.');
    c.patch(item, args.patch); c.stamp(ctx, item, 'updated');
  } else if (name === 'tasks.transition') {
    item = c.find(data, args.id);
    if (!transitions[item.status].includes(args.status)) c.fail('invalid_transition', 'Unsupported status transition.');
    if (args.status === 'completed' && item.blocked_by.some(id => c.find(data,id).status !== 'completed')) {
      c.fail('blocked', 'Complete prerequisite tasks first.');
    }
    const previous = item.status;
    item.status = args.status;
    item.completed_at = args.status === 'completed' ? ctx.virtual_now : null;
    c.stamp(ctx, item, previous + '_to_' + args.status);
  } else c.fail('unknown_tool', 'Unknown Tasks operation.');
  return {data, result:{id:item.id}};
}
module.exports = {handleTool};
