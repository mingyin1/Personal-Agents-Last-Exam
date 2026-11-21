'use strict';
const {person, fail} = require('./common.cjs');
function validate(ctx,data) {
  for(const contact of data.contacts) {
    person(ctx,contact.person_id);
    if(!contact.display_name.trim()) fail('invalid_seed','Display name cannot be blank.');
    if(contact.emails.some(e=>! /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) ||
       new Set(contact.emails.map(e=>e.toLowerCase())).size !== contact.emails.length) {
      fail('invalid_seed','Email addresses must be valid and unique within a contact.');
    }
    if(contact.phones.some(p=>! /^\+?[0-9 ()-]{5,40}$/.test(p))) fail('invalid_seed','Invalid telephone representation.');
  }
}
module.exports={validate};
