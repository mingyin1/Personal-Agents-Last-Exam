# Order notification adapter

A send-only workflow fixture, not a complete shopping App. It consumes the pinned `apps/messages/schemas/router-message.schema.json` contract; the workflow tests exact equality to prevent drift. Source identity and destination authorization come from the trusted messaging launch config. It does not implement Messages storage or bypass the receive operation.
