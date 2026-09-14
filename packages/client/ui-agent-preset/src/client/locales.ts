/** Locale bundles for the agent-preset hero chip, header label, and management section. */

/** Locale keys these surfaces render. */
export type AgentPresetSettingsKey =
  | 'error' | 'userTrust' | 'seatHint' | 'headerHint'
  | 'nav' | 'sectionIntro' | 'builtIn' | 'setDefault' | 'view'
  | 'presetStandardName' | 'presetStandardDescription'
  | 'presetPtcName' | 'presetPtcDescription'
  | 'presetMinimalName' | 'presetMinimalDescription'
  | 'presetCordisName' | 'presetCordisDescription'
  | 'duplicate' | 'duplicateUnavailable' | 'delete' | 'presetId' | 'presetIdPlaceholder' | 'copyOf'
  | 'displayName' | 'displayNamePlaceholder'
  | 'inUse' | 'noDescription' | 'builtInGroup' | 'customGroup'
  | 'brokenBadge' | 'brokenNoCopy' | 'switchRefused'
  | 'composition' | 'cancel' | 'close' | 'retry'
  | 'copyTitle' | 'copyIntro' | 'create' | 'creating' | 'creatorDraft'
  | 'openLocation' | 'showLocation' | 'revealedPathLabel'
  | 'idRequired' | 'idInvalid' | 'idTaken'
  | 'deleteTitle' | 'deleteDescription' | 'deleteConfirm' | 'deleting'

/** English copy. */
export const en: Record<AgentPresetSettingsKey, string> = {
  error: 'Could not load agent modes.',
  userTrust: 'Custom',
  seatHint: 'Mode for the chat you are about to start',
  headerHint: 'Mode for this chat — set when it started',
  nav: 'Modes',
  sectionIntro:
    'A mode chooses which tools this chat can use. Pick one, duplicate it to make it yours, '
    + 'or ask Creator to draft a custom mode.',
  builtIn: 'Built-in',
  setDefault: 'Set as default',
  view: 'View',
  presetStandardName: 'Agent',
  presetStandardDescription:
    'Full tools. Edit files, run commands, search, plan, and work in parallel.',
  presetPtcName: 'Code',
  presetPtcDescription:
    'Built for coding sessions — write and run programs without the extra workflow layer.',
  presetMinimalName: 'Lite',
  presetMinimalDescription:
    'Just the basics: terminal and file edits.',
  presetCordisName: 'Creator',
  presetCordisDescription:
    'Make your own agent mode. Advanced.',
  duplicate: 'Duplicate',
  duplicateUnavailable: 'This install has no folder for custom modes',
  delete: 'Delete',
  presetId: 'Identifier',
  presetIdPlaceholder: 'my-agent',
  displayName: 'Name',
  displayNamePlaceholder: 'Shown in the picker; defaults to the identifier',
  inUse: 'In use',
  builtInGroup: 'Built-in',
  customGroup: 'Custom',
  noDescription: 'No description.',
  brokenBadge: 'Failed to load',
  brokenNoCopy: 'A mode that failed to load cannot be duplicated',
  switchRefused: 'Could not switch to {name}: {reason}',
  copyOf: 'Copied from',
  composition: 'Advanced files',
  cancel: 'Cancel',
  close: 'Close',
  retry: 'Retry',
  copyTitle: 'Duplicate mode',
  copyIntro:
    'The whole mode is copied on this machine. The identifier becomes its folder name and cannot '
    + 'be changed later; everything else is edited in the mode\'s own files.',
  create: 'Create',
  creating: 'Creating…',
  creatorDraft: 'Draft a custom mode with Creator',
  openLocation: 'Open folder',
  showLocation: 'Show location',
  revealedPathLabel: 'Mode files:',
  idRequired: 'Give the mode an identifier.',
  idInvalid: 'Use lowercase letters, digits, and hyphens, starting with a letter or digit.',
  idTaken: 'A mode with this identifier already exists.',
  deleteTitle: 'Delete this mode?',
  deleteDescription:
    'The mode folder is deleted. Chats already running on it keep working; new chats cannot select it.',
  deleteConfirm: 'Delete',
  deleting: 'Deleting…',
}

/** Simplified Chinese copy. */
export const zh: Record<AgentPresetSettingsKey, string> = {
  error: '无法加载模式。',
  userTrust: '自定义',
  seatHint: '即将开始的对话所用的模式',
  headerHint: '本对话使用的模式，开始时即固定',
  nav: '模式',
  sectionIntro: '模式决定本对话可用的工具。选择一个，复制后改成自己的，或用「创造」让助手帮你起草。',
  builtIn: '内置',
  setDefault: '设为默认',
  view: '查看',
  presetStandardName: 'Agent',
  presetStandardDescription: '完整工具：编辑文件、运行命令、搜索、规划，并可并行协作。',
  presetPtcName: 'Code',
  presetPtcDescription: '面向编程会话——编写并运行程序，不含额外工作流层。',
  presetMinimalName: 'Lite',
  presetMinimalDescription: '仅基础能力：终端与文件编辑。',
  presetCordisName: 'Creator',
  presetCordisDescription: '创建你自己的模式。进阶。',
  duplicate: '复制',
  duplicateUnavailable: '此安装未配置可写的模式目录',
  delete: '删除',
  presetId: '标识符',
  presetIdPlaceholder: 'my-agent',
  displayName: '名称',
  displayNamePlaceholder: '选择器中显示的名字，缺省用标识符',
  inUse: '当前使用',
  builtInGroup: '内置',
  customGroup: '自定义',
  noDescription: '暂无描述。',
  brokenBadge: '加载失败',
  brokenNoCopy: '模式加载失败，不能复制',
  switchRefused: '无法切换到「{name}」：{reason}',
  copyOf: '复制自',
  composition: '高级文件',
  cancel: '取消',
  close: '关闭',
  retry: '重试',
  copyTitle: '复制模式',
  copyIntro: '整个模式会在本机复制一份。标识符将成为目录名，事后无法更改；其余内容之后直接在模式自己的文件里编辑。',
  create: '创建',
  creating: '正在创建…',
  creatorDraft: '用「创造」起草自定义模式',
  openLocation: '打开目录',
  showLocation: '查看路径',
  revealedPathLabel: '模式文件：',
  idRequired: '请填写标识符。',
  idInvalid: '只能使用小写字母、数字与连字符，且以字母或数字开头。',
  idTaken: '该标识符已被占用。',
  deleteTitle: '删除该模式？',
  deleteDescription: '模式目录将被删除。已在其上运行的对话不受影响；新对话将无法再选择它。',
  deleteConfirm: '删除',
  deleting: '正在删除…',
}

// The resolution itself is the shared fold in `dsh-agent-presets/display`,
// re-exported here so every surface in this plugin reads one path; the
// Settings plugin list inlines the same fold over this plugin's dictionaries.
export { presetDisplayText } from '@deepseek-ai/dsh-agent-presets/display'
export type { PresetDisplaySource, PresetDisplayText } from '@deepseek-ai/dsh-agent-presets/display'
