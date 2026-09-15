/** Schema-checked orchestrator and role-specialist agents over one model adapter. */
import { randomUUID } from 'node:crypto'
import { agentProposalSchema, botPlanSchema } from './config.ts'
import type { BotAgent, BotModel, BotModelContext, BotOrchestrator } from './contracts.ts'
import type { AgentProposal, BotId, BotTask } from './types.ts'

/** Reject oversized untrusted output before parsing its execution fields. */
function bounded(value: unknown, context: BotModelContext): unknown {
  if (value === undefined) throw new Error('SaturnBot model returned no output')
  const serialized = JSON.stringify(value)
  if (Buffer.byteLength(serialized) > context.config.maxInputBytes) throw new Error('SaturnBot model output exceeds its configured byte limit')
  return value
}

/** Planner that may return no tasks when current observations justify waiting. */
export class SaturnBotOrchestrator implements BotOrchestrator {
  constructor(private readonly model: BotModel) {}
  async plan(context: BotModelContext): Promise<{ summary: string; tasks: BotTask[] }> {
    const plan = botPlanSchema.parse(bounded(await this.model.plan(context), context))
    if (plan.tasks.length > context.config.maxTasks) throw new Error('Planner exceeded configured task limit')
    for (const task of plan.tasks) if (!context.config.roles[task.role].enabled) throw new Error(`Planner selected disabled role ${task.role}`)
    return { summary: plan.summary, tasks: plan.tasks.map(task => ({ ...task, id: randomUUID() as BotId })) }
  }
}

/** One specialist's role is fixed by the runtime, not by returned JSON. */
export class SaturnBotAgent implements BotAgent {
  constructor(readonly role: BotAgent['role'], private readonly model: BotModel) {}
  async propose(task: BotTask, context: BotModelContext): Promise<AgentProposal> {
    if (task.role !== this.role) throw new Error('Specialist task role mismatch')
    const proposal = agentProposalSchema.parse(bounded(await this.model.propose(task, context), context))
    if (proposal.actions.length > context.config.maxActionsPerTask) throw new Error('Specialist exceeded configured action limit')
    return { summary: proposal.summary, actions: proposal.actions, continue: proposal.continue ?? false }
  }
}
