/** `layout` namespace dictionaries: the phone shell's title strip and drawer. */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'mobile.menu.open': '打开会话抽屉',
  'mobile.menu.close': '关闭会话抽屉',
  'mobile.drawer': '会话与工作区',
} satisfies Record<string, string>

/** The layout namespace key union. */
export type LayoutKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'mobile.menu.open': 'Open session drawer',
  'mobile.menu.close': 'Close session drawer',
  'mobile.drawer': 'Sessions and workspaces',
} satisfies Record<LayoutKey, string>
