import { vi } from 'vitest'
import type {} from '../src/client/mount.ts'
import type { BotBranch, BotConfig, BotId, BotSnapshot } from '@saturnai/dsh-saturnbot/client'
import type { SaturnBotActions, SaturnBotViewState } from '../src/client/contracts.ts'

export const at = '2026-09-14T12:00:00.000Z'
export const id = (value: string): BotId => value as BotId
export const config: BotConfig = {
  version: 1, enabled: false, goal: 'Review the workspace and prepare a useful change.', workspace: 'C:/work/saturn',
  intervalMinutes: 60, provider: 'local', model: 'configured-model', maxTasks: 4, maxActionsPerTask: 8,
  toolTimeoutMs: 30_000, modelTimeoutMs: 60_000, maxInputBytes: 128_000, maxOutputTokens: 4096,
  requirePrApproval: true, autoDispatchEmail: false, requireDeployApproval: true, requireWriteApproval: true,
  allowedTools: ['files.read', 'files.write'], validationCommands: [['npm', 'test']], integrations: {}, reportChannel: 'daily',
  roles: {
    orchestrator: { enabled: true, instructions: '', tools: [] },
    developer: { enabled: true, instructions: '', tools: ['files.read', 'files.write'] },
    growth: { enabled: true, instructions: '', tools: [] },
    operations: { enabled: true, instructions: '', tools: [] },
    finance: { enabled: true, instructions: '', tools: [] },
  },
}
export const branch: BotBranch = {
  id: id('branch-1'), task: { id: id('task-1'), role: 'developer', title: 'Review navigation', instruction: 'Inspect the existing navigation.' },
  status: 'running', summary: 'Inspecting the workspace.', actions: [{ tool: 'files.read', input: { path: 'README.md' } }],
  nextAction: 0, continue: false, rounds: 0, stage: null, validatedRevision: null, error: null,
}
export function snapshot(patch: Partial<BotSnapshot> = {}): BotSnapshot {
  return {
    config, status: 'disabled', activeCycle: null, cycles: [], approvals: [], reports: [], alerts: [], cursor: 0,
    nextRunAt: null, tools: [], messages: [], connections: [], ...patch,
  }
}
export function state(value = snapshot()): SaturnBotViewState {
  return { snapshot: value, events: [], loading: false, error: null, memory: [], tickets: [], webhooks: [], recordsLoading: false }
}
export function actions(): SaturnBotActions {
  return {
    refresh: vi.fn(async () => {}), configure: vi.fn(async () => {}), runNow: vi.fn(async () => {}),
    pause: vi.fn(async () => {}), cancel: vi.fn(async () => {}), approve: vi.fn(async () => {}),
    message: vi.fn(async () => {}), loadMoreEvents: vi.fn(async () => {}), loadRecords: vi.fn(async () => {}),
  }
}
