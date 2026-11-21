# Contributed Apps

Add new complete App packages under `<app-id>/` after proposal scope review. Reference Mail and Calendar remain under `examples/apps/`; do not create duplicate implementations here.

Read [App contribution](../docs/app-contribution.md), [integration with other Apps](../docs/app-integrations.md) and [implementation review](../docs/review/app-implementation.md). Use the public runtime for local integration verification. Keep production configuration and generated state out of the package.

## Shared personal-App packages

| App | Package | Main workflow |
| --- | --- | --- |
| Files | [files/](files/) | Original files, folders, versions and evidence |
| Messages | [messages/](messages/) | Conversations, read flags, attachments and chat delivery |
| Notes | [notes/](notes/) | Notes, preferences, revisions and attachments |
| Tasks | [tasks/](tasks/) | Lists, assignments, deadlines and completion |
| Contacts | [contacts/](contacts/) | Stable person references and contact methods |

Start with the [suite guide](../docs/personal-apps.md) for source references, exact capabilities and commands. Run `npm run test:personal-apps` to validate all five. The [cross-App workflow](../examples/workflows/personal-apps/) shows how to consume another App's interfaces and verify the real receiving state. These packages are submitted by maintainers directly for implementation review; code and validation evidence remain subject to normal review before adoption.
