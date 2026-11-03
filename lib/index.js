/**
 * Host half of dsh-session-recycle-tools.
 *
 * Everything this plugin does lives in the browser half (`client.js`): the two
 * footer buttons above the settings row, and the recycle-bin / batch-delete
 * dialogs. The host row exists only so the package has a Loader entry — that
 * entry is what `dsh-client-modules` scans for a `dsh.client` declaration, and
 * therefore what gets the client bundle served to the page.
 *
 * No host service, route, or tool is registered here on purpose: the plugin is
 * pure UI over services that already exist (uiWorkspace / workspaces /
 * sessions), so it adds no surface the model can see and no state of its own.
 */

export const name = 'dsh-session-recycle-tools'

export function apply() {}
