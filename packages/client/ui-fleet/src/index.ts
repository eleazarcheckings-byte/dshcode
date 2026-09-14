/**
 * Fleet route surface, node half. Pure UI plugin: the empty apply exists so the
 * plugin appears in the host cordis.yml / Loader; the browser half ships via
 * exports["./client"], discovered through the package.json dsh.client
 * declaration.
 *
 * Every fact this surface reads is already published by another layer:
 * `@deepseek-ai/dsh-api-session-controller` (list rows, background jobs,
 * direct-child catalogs) and `@deepseek-ai/dsh-client-ui-session` (pending
 * interactions), with the goal's blocked phase riding the list row's own
 * projection values. This package owns no host-side state, declares no
 * projection, and adds no tool.
 */

/** Host plugin body — no host-side behavior for this surface plugin. */
export function apply(): void {}
