/** `fleet` namespace dictionaries (the fleet route surface's copy). */

/** Dictionary namespace owned by this plugin. */
export const NS = 'fleet'

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'empty': '编队 · 暂无委派任务',
  'list.aria': '已委派的子代理',
  'status.running': '运行中',
  'status.done': '已完成',
  'status.waiting': '等待你处理',
  'status.blocked': '受阻于 {blocker}',
  'need.approval': '等待审批',
  'need.planReview': '计划待审',
  'need.question': '等待你回答',
  'row.open': '在其父级会话中打开这个子代理',
  'heading': '团队动态',
  'summary.running': '{count} 个正在工作',
  'summary.attention': '{count} 个需要关注',
  'expand': '显示另外 {count} 个代理',
  'collapse': '收起团队列表',
} as const

/** Key domain of the `fleet` namespace (zh is the source of truth). */
export type FleetKey = keyof typeof zh

/** English dictionary, key-identical to the Chinese source of truth. */
export const en: Record<FleetKey, string> = {
  'empty': 'Fleet · no delegated workers',
  'list.aria': 'Delegated workers',
  'status.running': 'Running',
  'status.done': 'Done',
  'status.waiting': 'Waiting for you',
  'status.blocked': 'Blocked on {blocker}',
  'need.approval': 'Waiting for approval',
  'need.planReview': 'Plan awaiting review',
  'need.question': 'Waiting for your answer',
  'row.open': 'Opens this worker in its parent context',
  'heading': 'Team activity',
  'summary.running': '{count} working',
  'summary.attention': '{count} need attention',
  'expand': 'Show {count} more agents',
  'collapse': 'Show fewer agents',
}
