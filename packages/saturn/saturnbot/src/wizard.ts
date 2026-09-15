/** Static and config-derived projections consumed only by the first-run wizard. */
import type { BotConfig } from './types.ts'

/** One provider credential the wizard should confirm before the daemon can run at all. */
export interface BotFirstRunCredential { name: string; env: string; present: boolean }
/** Wizard-facing summary of the values that gate an initial run. */
export interface BotFirstRun {
  goal: string
  workspace: string
  provider: string
  credentials: BotFirstRunCredential[]
}
/** One field of a generated connect form. `secret` fields are never echoed; the UI shows `env` and guides pasting the value into `.env`. */
export interface BotIntegrationField { key: string; label: string; secret: boolean; env?: string }
/** One integration's connect-form description. */
export interface BotIntegrationCatalogEntry { name: string; label: string; fields: BotIntegrationField[]; docsUrl: string }

/**
 * Curated credential environment variable names for the harness's known
 * built-in and keyless-router provider ids (see the model-router cell's
 * curated `llm-pi-ai` profiles). An unrecognized provider returns no rows
 * rather than a fabricated one — the wizard shows nothing instead of a
 * guess it cannot back up.
 */
const KNOWN_PROVIDER_CREDENTIALS: Readonly<Record<string, readonly BotFirstRunCredential[]>> = Object.freeze({
  'deepseek-official': [{ name: 'DeepSeek', env: 'DEEPSEEK_API_KEY', present: false }],
  anthropic: [{ name: 'Anthropic', env: 'ANTHROPIC_API_KEY', present: false }],
  openai: [{ name: 'OpenAI', env: 'OPENAI_API_KEY', present: false }],
  google: [{ name: 'Google', env: 'GOOGLE_API_KEY', present: false }],
  xai: [{ name: 'xAI', env: 'XAI_API_KEY', present: false }],
  moonshotai: [{ name: 'Moonshot AI', env: 'MOONSHOT_API_KEY', present: false }],
  zai: [{ name: 'Z.ai', env: 'ZAI_API_KEY', present: false }],
})

/**
 * Summarize the wizard's opening screen: the standing goal/workspace/provider
 * and whether the configured provider's known credential is actually set.
 * @param config - current validated configuration.
 * @param environment - the merged environment SaturnBot resolves credentials from.
 * @returns the wizard's first-run projection.
 */
export function describeFirstRun(config: BotConfig, environment: Readonly<NodeJS.ProcessEnv>): BotFirstRun {
  const known = KNOWN_PROVIDER_CREDENTIALS[config.provider] ?? []
  return {
    goal: config.goal, workspace: config.workspace, provider: config.provider,
    credentials: known.map(entry => ({ ...entry, present: Boolean(environment[entry.env]) })),
  }
}

/**
 * The fixed catalog of every integration this runtime's adapters support,
 * described as connect-form fields. Static: it does not depend on current
 * configuration (see `connections` on the snapshot for live configured/
 * unconfigured status per integration).
 * @returns the field-level catalog for the wizard's generated connect forms.
 */
export function botIntegrationCatalog(): BotIntegrationCatalogEntry[] {
  return [
    {
      name: 'github', label: 'GitHub', docsUrl: 'https://docs.github.com/en/rest/pulls/pulls',
      fields: [
        { key: 'token', label: 'Personal access token (repository contents + pull requests write)', secret: true, env: 'SATURN_GITHUB_TOKEN' },
        { key: 'resource', label: 'Repository (owner/repository)', secret: false },
      ],
    },
    {
      name: 'email', label: 'Microsoft Graph mail', docsUrl: 'https://learn.microsoft.com/en-us/graph/api/user-sendmail',
      fields: [
        { key: 'token', label: 'Graph app token (Mail.Read, Mail.ReadWrite, Mail.Send)', secret: true, env: 'SATURN_GRAPH_TOKEN' },
        { key: 'resource', label: 'Mailbox user ID or email address', secret: false },
      ],
    },
    {
      name: 'stripe', label: 'Stripe', docsUrl: 'https://docs.stripe.com/keys',
      fields: [{ key: 'token', label: 'Restricted API key (balance + balance transactions read)', secret: true, env: 'SATURN_STRIPE_KEY' }],
    },
    {
      name: 'telegram', label: 'Telegram', docsUrl: 'https://core.telegram.org/bots#how-do-i-create-a-bot',
      fields: [
        { key: 'token', label: 'Bot token (from @BotFather)', secret: true, env: 'SATURN_TELEGRAM_BOT_TOKEN' },
        { key: 'resource', label: 'Default chat ID for reports and sends', secret: false },
      ],
    },
    {
      name: 'shopify', label: 'Shopify', docsUrl: 'https://shopify.dev/docs/api/admin-rest',
      fields: [
        { key: 'token', label: 'Admin API access token', secret: true, env: 'SATURN_SHOPIFY_TOKEN' },
        { key: 'resource', label: 'Store domain (your-store.myshopify.com)', secret: false },
      ],
    },
    {
      name: 'vercel', label: 'Vercel', docsUrl: 'https://vercel.com/docs/deployments/deploy-hooks',
      fields: [
        { key: 'endpoint', label: 'Deploy hook URL', secret: false },
        { key: 'token', label: 'Optional bearer token, only if your hook requires one', secret: true, env: 'SATURN_VERCEL_TOKEN' },
      ],
    },
    {
      name: 'cloudflare-pages', label: 'Cloudflare Pages', docsUrl: 'https://developers.cloudflare.com/pages/configuration/deploy-hooks/',
      fields: [
        { key: 'endpoint', label: 'Deploy hook URL', secret: false },
        { key: 'token', label: 'Optional bearer token, only if your hook requires one', secret: true, env: 'SATURN_CLOUDFLARE_PAGES_TOKEN' },
      ],
    },
    {
      name: 'cloud', label: 'Deployment webhook (generic)', docsUrl: 'https://github.com/deepseek-ai/deepseek-harness/blob/main/packages/saturn/saturnbot/ADAPTERS.md',
      fields: [
        { key: 'endpoint', label: 'Deployment endpoint URL', secret: false },
        { key: 'token', label: 'Deployment bearer token', secret: true, env: 'SATURN_DEPLOY_TOKEN' },
        { key: 'resource', label: 'Project ID', secret: false },
      ],
    },
    {
      name: 'social', label: 'Social publishing webhook (generic)', docsUrl: 'https://github.com/deepseek-ai/deepseek-harness/blob/main/packages/saturn/saturnbot/ADAPTERS.md',
      fields: [
        { key: 'endpoint', label: 'Publishing endpoint URL', secret: false },
        { key: 'token', label: 'Publishing bearer token', secret: true, env: 'SATURN_SOCIAL_TOKEN' },
      ],
    },
    {
      name: 'creative', label: 'Creative generation webhook (generic)', docsUrl: 'https://github.com/deepseek-ai/deepseek-harness/blob/main/packages/saturn/saturnbot/ADAPTERS.md',
      fields: [
        { key: 'endpoint', label: 'Generation endpoint URL (skip when a connected media provider is present)', secret: false },
        { key: 'token', label: 'Generation bearer token', secret: true, env: 'SATURN_CREATIVE_TOKEN' },
      ],
    },
    {
      name: 'webhook', label: 'Signed inbound webhook', docsUrl: 'https://github.com/deepseek-ai/deepseek-harness/blob/main/packages/saturn/saturnbot/ADAPTERS.md#signed-webhook-ingress',
      fields: [{ key: 'token', label: 'Shared HMAC signing secret', secret: true, env: 'SATURN_WEBHOOK_SECRET' }],
    },
  ]
}
