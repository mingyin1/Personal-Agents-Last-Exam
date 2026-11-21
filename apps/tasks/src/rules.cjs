'use strict';
const {person, fail} = require('./common.cjs');
function validate(ctx, data) {
  const tasks = new Map(data.tasks.map(t => [t.id, t]));
  for (const task of data.tasks) {
    person(ctx, task.assignee_person_id);
    if (!task.title.trim() || !task.list.trim()) fail('invalid_seed', 'Title and list cannot be blank.');
    if ((task.status === 'completed') !== (task.completed_at !== null)) {
      fail('invalid_seed', 'Completion time must agree with task status.');
    }
    if (task.completed_at && (Date.parse(task.completed_at) < Date.parse(task.created_at) ||
        Date.parse(task.completed_at) > Date.parse(task.updated_at))) fail('invalid_seed', 'Invalid completion time.');
    if (task.blocked_by.some(id => id === task.id || !tasks.has(id))) fail('invalid_seed', 'Missing or self-referential blocker.');
  }
  const visiting = new Set(), done = new Set();
  function visit(id) {
    if (visiting.has(id)) fail('invalid_seed', 'Task dependencies cannot form a cycle.');
    if (done.has(id)) return;
    visiting.add(id);
    tasks.get(id).blocked_by.forEach(visit);
    visiting.delete(id); done.add(id);
  }
  for (const id of tasks.keys()) visit(id);
}
module.exports = {validate};
