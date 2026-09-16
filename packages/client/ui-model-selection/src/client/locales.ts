/**
 * `model` namespace dictionaries.
 *
 * `trigger.selectAria` intentionally matches `trigger.fallback` but remains a
 * separate key: the visible fallback label and the accessible name of
 * an unset trigger are free to diverge per locale, and folding it into
 * `trigger.aria` would announce the degenerate "Select model, current Select
 * model".
 */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'command.description': '选择本会话使用的模型',
  'option.loadError': '目录加载失败：{message}',
  'trigger.fallback': '选择模型',
  'trigger.loading': '正在加载模型…',
  'trigger.selectAria': '选择模型',
  'trigger.aria': '选择模型，当前 {model}',
  'trigger.ariaEffort': '选择模型，当前 {model}，推理等级 {effort}',
  'menu.aria': '模型与推理等级',
  'menu.model': '模型',
  'menu.effort': '推理等级',
  'effort.providerDefault': 'Default',
  'status.loading': '正在刷新模型列表…',
  'error.action': '模型操作失败：{message}',
  'action.reload': '重新加载',
  'warning.groupLoad': '{name} 加载失败：{message}',
  'empty.models': '没有可用的模型。',
  'blocked.composer': '当前模型不可用，请先选择模型',
  'empty.efforts': '当前模型未提供推理等级。',
  'badge.imageInput': '图片输入',
  'badge.imageGeneration': '生图',
  'badge.imageUnderstanding': '识图',
  'badge.tools': '工具',
  'badge.context': '{size} 上下文',
  'menu.route': '路由',
  'route.fastest': '最快（默认）',
  'route.cheapest': '最便宜',
  'route.preferred': '按我的偏好',
  'hf.search': '搜索模型',
  'hf.idLabel': '输入 Hugging Face 模型 ID（org/name）',
  'hf.idUse': '使用此 ID',
  'hf.idInvalid': '模型 ID 须为 org/name，可附 :provider 或 :cheapest 等后缀。',
  'hf.error.unauthorized': 'Hugging Face 令牌无效，或缺少“调用 Inference Providers”权限。',
  'hf.error.credits': 'Hugging Face 额度已用完，请前往 huggingface.co/settings/billing 充值。',
  'hf.error.gated': '该模型需授权：请在 huggingface.co 上接受其许可协议。',
  'hf.error.notFound': '找不到该模型，或当前没有可用的服务商。',
  'hf.error.rateLimited': 'Hugging Face 限流中，请稍后重试。',
} satisfies Record<string, string>

/** The model namespace key union. */
export type ModelKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'command.description': 'Select the model for this conversation',
  'option.loadError': 'Catalog failed to load: {message}',
  'trigger.fallback': 'Select model',
  'trigger.loading': 'Loading models…',
  'trigger.selectAria': 'Select model',
  'trigger.aria': 'Select model, current {model}',
  'trigger.ariaEffort': 'Select model, current {model}, reasoning effort {effort}',
  'menu.aria': 'Model and reasoning effort',
  'menu.model': 'Model',
  'menu.effort': 'Effort',
  'effort.providerDefault': 'Default',
  'status.loading': 'Refreshing model list…',
  'error.action': 'Model operation failed: {message}',
  'action.reload': 'Reload',
  'warning.groupLoad': '{name} failed to load: {message}',
  'empty.models': 'No models available.',
  'blocked.composer': 'This model is unavailable — select one to continue',
  'empty.efforts': 'This model provides no reasoning effort levels.',
  'badge.imageInput': 'Image input',
  'badge.imageGeneration': 'Image generation',
  'badge.imageUnderstanding': 'Image understanding',
  'badge.tools': 'Tools',
  'badge.context': '{size} context',
  'menu.route': 'Routing',
  'route.fastest': 'Fastest (default)',
  'route.cheapest': 'Cheapest',
  'route.preferred': 'My preferred order',
  'hf.search': 'Search models',
  'hf.idLabel': 'Hugging Face model id (org/name)',
  'hf.idUse': 'Use this id',
  'hf.idInvalid': 'A model id is org/name, optionally with a suffix such as :provider or :cheapest.',
  'hf.error.unauthorized': 'The Hugging Face token is invalid or lacks the "Make calls to Inference Providers" permission.',
  'hf.error.credits': 'Hugging Face credits are used up — add credits at huggingface.co/settings/billing.',
  'hf.error.gated': 'This model is gated — accept its license on huggingface.co first.',
  'hf.error.notFound': 'Model not found, or no provider is serving it right now.',
  'hf.error.rateLimited': 'Hugging Face is rate limiting requests — try again shortly.',
} satisfies Record<ModelKey, string>
