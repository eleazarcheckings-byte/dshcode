/** `orchestrate` namespace dictionaries (the composer multi-task toggle's copy). */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'toggle.label': '多任务',
  'toggle.on.aria': '多任务模式已开启，按下关闭',
  'toggle.on.title': '多任务模式已开启 — 点击关闭（/orchestrate off）',
  'toggle.off.aria': '多任务模式已关闭，按下开启',
  'toggle.off.title': '多任务模式已关闭 — 点击开启（/orchestrate on）',
  'toggle.pending.aria': '多任务模式将在下一步生效',
  'toggle.pending.title': '多任务模式将在下一步生效',
  'toggle.failed': '切换多任务模式失败',
} satisfies Record<string, string>

/** The orchestrate namespace key union. */
export type OrchestrateKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'toggle.label': 'Multi-task',
  'toggle.on.aria': 'Multi-task mode on, press to turn off',
  'toggle.on.title': 'Multi-task mode on — click to turn off (/orchestrate off)',
  'toggle.off.aria': 'Multi-task mode off, press to turn on',
  'toggle.off.title': 'Multi-task mode off — click to turn on (/orchestrate on)',
  'toggle.pending.aria': 'Multi-task mode changes from the next step',
  'toggle.pending.title': 'Multi-task mode changes from the next step',
  'toggle.failed': 'Failed to switch multi-task mode',
} satisfies Record<OrchestrateKey, string>
