'use strict';
const {fail} = require('./common.cjs');
function validate(ctx,data) {
  for(const n of data.notes){
    if(!n.title.trim()) fail('invalid_seed','Note title cannot be blank.');
    if(n.revisions.some(r=>Date.parse(r.at)>Date.parse(n.updated_at))) fail('invalid_seed','Revision cannot be newer than the note.');
  }
}
module.exports={validate};
