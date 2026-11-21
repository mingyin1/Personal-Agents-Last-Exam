'use strict';
// App packages declare the portable Core API 1.2 lifecycle baseline. Platform
// extensions are discovered on the Infra connection, not implemented by Apps.
const baseline=Object.freeze(['env.reset','env.load_seed','env.apply_event','env.snapshot','env.event_status','env.validate_bundle']);
const operations=Object.freeze([...baseline,'env.advance_time']);
module.exports={baseline,operations};
