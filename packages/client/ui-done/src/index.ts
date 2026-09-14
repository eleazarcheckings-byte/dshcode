/**
 * Definition-of-done strip, node half. Pure UI plugin: the empty apply exists so
 * the plugin appears in the host cordis.yml / Loader; the browser half ships via
 * exports["./client"], discovered through the package.json dsh.client
 * declaration. The contract itself (the /done command, the done projection unit,
 * the policy section, the set_definition_of_done tool) is owned by
 * `@saturnai/dsh-done`, composed independently on the host roster.
 */

/** Host plugin body — no host-side behavior for this surface plugin. */
export function apply(): void {}
