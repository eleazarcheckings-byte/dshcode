/**
 * The shipped Gate policy: the rules that stop a call by default. They are
 * data, not branches — a deployment appends its own rules, drops one by id, or
 * replaces the set entirely through this plugin's config.
 *
 * Two families live here. Shell rules match the text of a command a shell tool
 * is about to run. MCP rules match a tool NAME, because an MCP tool's name
 * already states its effect (`keychain_get` reads a secret whatever its
 * arguments say). The MCP names are the ones the operator's own servers
 * register — telegram-hive, shop-ops, gemini-media, saturn-browser,
 * saturndesign — plus wildcards that catch the same effect on a server this
 * list has never seen.
 *
 * Order is meaningful: the first matching rule claims the call, and a `deny`
 * anywhere in the list beats every `ask`. Identity sits ahead of spend so
 * buying a domain reads as an identity act rather than a generic purchase.
 * @module @saturnai/dsh-gates/roster
 */

import type { GateRule } from './types.ts'

/**
 * The tools whose arguments carry a command line. Every shell rule is scoped
 * to this list, so the same text inside an unrelated tool's argument is not a
 * Gate (a `write` whose content quotes a force push is still just a write).
 */
export const SHELL_TOOLS: readonly string[] = [
  'bash',
  'pwsh',
  'terminal_send',
  'mcp__*__PowerShell',
  'mcp__*__Shell',
  'mcp__*__sandbox_exec',
  'mcp__saturn-gx__evaluate',
]

/** The argument fields a shell rule reads, joined with newlines before matching. */
export const DEFAULT_COMMAND_FIELDS: readonly string[] = ['command', 'script', 'text', 'input', 'expression']

/** The tools whose own body resolves a `sandbox_permissions` escalation through the approval seam. */
export const DEFAULT_ESCALATION_TOOLS: readonly string[] = ['bash', 'pwsh']

/**
 * The default policy. Every rule states, in `reason`, what the call would do —
 * that sentence is what the model and the user read when the call stops.
 */
export const DEFAULT_RULES: readonly GateRule[] = [
  // --- Denied outright: effects that take the machine, not just the session. ---
  {
    id: 'deny-fork-bomb',
    class: 'destructive',
    action: 'deny',
    tools: [...SHELL_TOOLS],
    pattern: String.raw`:\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:`,
    reason: 'This command is a fork bomb and would take the machine down.',
  },
  {
    id: 'deny-root-wipe',
    class: 'destructive',
    action: 'deny',
    tools: [...SHELL_TOOLS],
    pattern: String.raw`\brm\s+(?:-\S+\s+)+(?:/|~|%USERPROFILE%|\$HOME)(?:\*)?(?:\s|$|[;&|])`,
    reason: 'This command recursively deletes the filesystem root or the whole home directory.',
  },
  {
    id: 'deny-disk-format',
    class: 'destructive',
    action: 'deny',
    tools: [...SHELL_TOOLS],
    pattern: String.raw`\b(?:mkfs(?:\.\w+)?|Format-Volume|diskpart|fdisk\s+/dev/)\b|\bformat\s+[A-Za-z]:`,
    reason: 'This command formats a disk and destroys everything on it.',
  },
  {
    id: 'deny-raw-disk-write',
    class: 'destructive',
    action: 'deny',
    tools: [...SHELL_TOOLS],
    pattern: String.raw`\bdd\b[^\n]*\bof=/dev/(?:sd|nvme|hd|disk|vd)`,
    reason: 'This command writes straight to a block device and destroys the partition on it.',
  },

  // --- Credentials: anything that reads, exports, or establishes a secret. ---
  {
    id: 'credentials-mcp-keychain',
    class: 'credentials',
    tools: ['mcp__*__keychain_*', 'mcp__*__keychain'],
    reason: 'This call reads or rewrites stored credentials.',
  },
  {
    id: 'credentials-mcp-session',
    class: 'credentials',
    tools: [
      'mcp__*__login',
      'mcp__*__identity_use',
      'mcp__*__cookies',
      'mcp__*__website_secrets',
      'mcp__*__*_secrets',
      'mcp__*__credentials',
    ],
    reason: 'This call signs in as someone or hands over the secrets that prove who they are.',
  },
  {
    id: 'credentials-cli-login',
    class: 'credentials',
    tools: [...SHELL_TOOLS],
    pattern: String.raw`\b(?:gh|vercel|wrangler|npm|pnpm|yarn|docker|firebase|heroku|supabase|netlify|az|gcloud|aws|op|doppler)\s+(?:[a-z-]+\s+)?login\b|\baws\s+configure\b|\bgit\s+credential\b`,
    reason: 'This command signs in to an account and stores the credential it receives.',
  },
  {
    id: 'credentials-secret-file-read',
    class: 'credentials',
    tools: [...SHELL_TOOLS],
    pattern: String.raw`\b(?:cat|bat|less|more|head|tail|type|Get-Content|gc|cp|copy|mv|move|scp|rsync|base64|xxd|strings)\b[^\n]*(?:\.env(?:\.[\w-]+)?\b|\bid_rsa\b|\bid_ed25519\b|\.pem\b|\.p12\b|\.pfx\b|\bcredentials\.json\b|\.npmrc\b|\.aws[\\/]credentials\b|\bsecrets?\.(?:json|ya?ml|toml)\b)`,
    reason: 'This command reads or copies a file that holds secrets.',
  },
  {
    id: 'credentials-secret-assignment',
    class: 'credentials',
    tools: [...SHELL_TOOLS],
    pattern: String.raw`(?:\bexport\s+|\bsetx\s+|\$env:|\bENV\s+)[A-Za-z_]*(?:TOKEN|SECRET|API_?KEY|PASSWORD|CREDENTIAL)[A-Za-z_]*\s*=`,
    reason: 'This command puts a secret value into the environment.',
  },

  // --- Identity: a name, a domain, or a DNS record that points at the operator. ---
  {
    id: 'identity-mcp-domain',
    class: 'identity',
    tools: ['mcp__*__buy_domain', 'mcp__*__update_dns', 'mcp__*__dns_*'],
    reason: 'This call registers or repoints a domain the operator is known by.',
  },
  {
    id: 'identity-dns-cli',
    class: 'identity',
    tools: [...SHELL_TOOLS],
    pattern: String.raw`\b(?:namecheap|route53|doctl\s+compute\s+domain|wrangler\s+dns)\b|\bcloudflare\b[^\n]*\bdns\b|\b(?:vercel|wrangler|gcloud)\s+domains?\s+(?:buy|add|purchase)\b`,
    reason: 'This command changes domain or DNS records the operator is known by.',
  },

  // --- Spend: anything billable, whether an API meter or a real invoice. ---
  {
    id: 'spend-mcp-generation',
    class: 'spend',
    tools: [
      'mcp__gemini-media__generate_image',
      'mcp__gemini-media__generate_video',
      'mcp__gemini-media__edit_image',
      'mcp__gemini-media__queue_mac_image',
      'mcp__*__generate_image',
      'mcp__*__generate_video',
      'mcp__*__generate_audio',
      'mcp__*__generate_3d',
      'mcp__*__upscale_*',
    ],
    reason: 'This call bills a paid generation API.',
  },
  {
    id: 'spend-mcp-commerce',
    class: 'spend',
    tools: [
      'mcp__shop-ops__create_invoice',
      'mcp__shop-ops__update_price',
      'mcp__*__create_invoice',
      'mcp__*__buy_*',
      'mcp__*__purchase*',
      'mcp__*__checkout*',
      'mcp__*__refund*',
    ],
    reason: 'This call moves money or changes what a customer is charged.',
  },
  {
    id: 'spend-payment-cli',
    class: 'spend',
    tools: [...SHELL_TOOLS],
    pattern: String.raw`\b(?:stripe|paypal|braintree|adyen)\b[^\n]*\b(?:create|charge|charges|payout|payouts|refund|refunds|capture|subscribe)\b`,
    reason: 'This command charges, refunds, or pays out real money.',
  },

  // --- Publish: anything that leaves the machine and becomes the live thing. ---
  {
    id: 'publish-mcp-deploy',
    class: 'publish',
    tools: [
      'mcp__shop-ops__deploy_store',
      'mcp__saturndesign__propose',
      'mcp__*__deploy_*',
      'mcp__*__publish_*',
    ],
    reason: 'This call publishes or deploys something other people will see.',
  },
  {
    id: 'publish-git-force-push',
    class: 'publish',
    tools: [...SHELL_TOOLS],
    pattern: String.raw`\bgit\s+push\b[^\n]*?(?:--force\b|--force-with-lease\b|\s-f\b)`,
    reason: 'This command force-pushes and can overwrite remote history other people share.',
  },
  {
    id: 'publish-deploy-command',
    class: 'publish',
    tools: [...SHELL_TOOLS],
    pattern: String.raw`\bvercel\s+(?:deploy\s+)?[^\n]*--prod\b|\bwrangler\s+(?:pages\s+)?deploy\b|\bnetlify\s+deploy\b[^\n]*--prod\b|\bgh\s+release\s+create\b|\b(?:npm|pnpm|yarn)\s+publish\b|\bdocker\s+push\b|\bfirebase\s+deploy\b|\beas\s+submit\b|\bship\.mjs\b|\bdeploy_pages\.sh\b`,
    reason: 'This command ships a live site, release, or package that other people will receive.',
  },

  // --- Outbound: a message that lands in front of a real person. ---
  {
    id: 'outbound-mcp-message',
    class: 'outbound',
    tools: [
      'mcp__telegram-hive__send_approved',
      'mcp__telegram-hive__schedule',
      'mcp__*__send_approved',
      'mcp__*__send_message',
      'mcp__*__send_email',
      'mcp__*__reply',
      'mcp__*__reply_to_*',
      'mcp__*__forward',
      'mcp__*__share_file',
      'mcp__*__tiktok_publish',
      'mcp__*__schedule',
    ],
    reason: 'This call sends a message that reaches a real person.',
  },
  {
    id: 'outbound-webhook-post',
    class: 'outbound',
    tools: [...SHELL_TOOLS],
    pattern: String.raw`\b(?:curl|curl\.exe|wget|Invoke-RestMethod|irm|Invoke-WebRequest|iwr)\b[^\n]*\b(?:hooks\.slack\.com|discord(?:app)?\.com/api/webhooks|api\.telegram\.org|api\.twitter\.com|api\.x\.com|api\.sendgrid\.com|api\.mailgun\.net|api\.resend\.com|api\.twilio\.com|graph\.facebook\.com|open\.tiktokapis\.com|api\.linkedin\.com|webhook\.site)`,
    reason: 'This command posts to a channel that publishes or messages real people.',
  },
  {
    id: 'outbound-mail-cli',
    class: 'outbound',
    tools: [...SHELL_TOOLS],
    pattern: String.raw`\b(?:sendmail|msmtp|swaks|mailx)\b|\bmail\s+-s\b`,
    reason: 'This command sends email to a real address.',
  },

  // --- Destructive: irreversible locally, and often somewhere else too. ---
  {
    id: 'destructive-recursive-delete',
    class: 'destructive',
    tools: [...SHELL_TOOLS],
    pattern: String.raw`\brm\s+(?=(?:-\S+\s+)*-\S*r)(?=(?:-\S+\s+)*-\S*f)(?:-\S+\s+)+(?:/|~|\$HOME|%USERPROFILE%|[A-Za-z]:[\\/]|\*)`,
    reason: 'This command recursively deletes a path outside the workspace.',
  },
  {
    id: 'destructive-windows-delete',
    class: 'destructive',
    tools: [...SHELL_TOOLS],
    pattern: String.raw`\bRemove-Item\b(?=[^\n]*-Recurse\b)(?=[^\n]*-Force\b)|\b(?:rmdir|rd)\s+/[sS]\b|\bdel\s+/[a-zA-Z]*[sS]\b`,
    reason: 'This command recursively force-deletes a directory tree.',
  },
  {
    id: 'destructive-git-history',
    class: 'destructive',
    tools: [...SHELL_TOOLS],
    pattern: String.raw`\bgit\s+(?:reset\s+--hard\b|clean\b[^\n]*\s-[a-zA-Z]*f[a-zA-Z]*\b|filter-branch\b)`,
    reason: 'This command throws away uncommitted work or rewrites history, and nothing restores it.',
  },
  {
    id: 'destructive-database-drop',
    class: 'destructive',
    tools: [...SHELL_TOOLS],
    pattern: String.raw`\b(?:DROP\s+(?:TABLE|DATABASE|SCHEMA)|TRUNCATE\s+TABLE)\b`,
    reason: 'This command drops a table or database and the rows in it are gone.',
  },
]
