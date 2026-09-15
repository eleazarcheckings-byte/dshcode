# @saturnai/dsh-orchestrate

The session multi-task setting is logged and defaults to ON. `/orchestrate [on|off]` changes the setting; a change during an active turn applies at the next accepted step. Resuming or forking a session retains its logged selection.

ON guides the coordinator to assign independent work with concrete deliverables, context, disjoint file scopes and verification requirements. It prefers named Team members for ongoing shared work and one-shot subagents for bounded independent work. The coordinator reviews the combined result and waits for required teammates before answering. Trivial or tightly dependent work remains in the main thread.

OFF asks the agent to work in one thread unless the user requests delegation. Both settings change model guidance while preserving the tool catalog. Deployments can supply non-empty `on` and `off` strings to replace the default guidance.
