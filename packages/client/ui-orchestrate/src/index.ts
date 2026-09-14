/**
 * Multi-task toggle plugin, node half. Pure UI plugin: the empty apply exists
 * so the plugin appears in the host cordis.yml / Loader; the browser half ships
 * via exports["./client"], discovered through the package.json dsh.client
 * declaration. Multi-task behavior itself (the /orchestrate command, the
 * orchestrate projection unit, the policy section) is owned by
 * `@saturnai/dsh-orchestrate`, composed independently on the host roster.
 */

/** Host plugin body — no host-side behavior for this surface plugin. */
export function apply(): void {}
