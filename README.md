# dsh-session-recycle-tools

Adds two entries to the DeepSeek Harness web sidebar, stacked **above the settings row** at the bottom left:

```
  ☑  Batch delete            <- this plugin
  🗑  Recycle bin            <- this plugin
  ⚙  Settings                <- the host's own row
```

## The recycle bin is its own list, not the host archive

The sidebar's built-in archive writes `workspaces.archivedSessionIds` and shares one "archived" view. This plugin does
not touch it: the two coexist and neither knows about the other.

| | Host archive | This recycle bin |
| --- | --- | --- |
| Recorded in | `archivedSessionIds` in the workspace record | the plugin's own list in `localStorage` (`dsh-session-tools.trash.v1`) |
| Hiding | the host filters the row | the plugin wraps `uiWorkspace.isSessionVisible`; only ids in its own list return `false` |
| Restore | unarchive through the host | delete the id from the list; the session is back immediately |
| Relationship | unaware of the recycle bin | calls the host's original filter unchanged, then intersects it with its own set |

How `client.js` does it:

1. `apply()` resolves `ctx.get('uiWorkspace')` and replaces `isSessionVisible` with
   `(id) => trash.has(id) ? false : original(id)`, restoring the original in the `ctx.effect` cleanup. Whatever the host
   already filtered (a workbench session filter, for example) still runs through `original(id)` with the same meaning.
2. After the list changes, `uiWorkspace.sessionVisibility` is bumped so the sidebar tree recomputes its rows.
3. Moving a session sends **no** archive request. **Permanently delete** is the only path that calls the host's
   `uiWorkspace.deleteSession()`, the same path as "permanently delete session" in the session context menu.
4. A session that is currently running is refused: it would otherwise vanish from the list while still working in the
   background. The dialog says so instead.
5. An id that disappears from the session list entirely is pruned from the bin after a 60-second grace period.

Known cost: the list lives in the browser's `localStorage` for the current origin (`http://127.0.0.1:<port>`). Clearing
site data or switching ports empties the recycle bin; the only consequence is that those sessions reappear in the list,
and no content is lost.

## Layout

The host half is a single loader row whose only job is to let `dsh-client-modules` see this package's `dsh.client`
declaration and serve `client.js` to the page. The plugin registers no host service, route, or tool, so the model cannot
see it.

```
.
|- package.json           # dsh.bundle.patch + dsh.client { platform: 'web' }
|- cordis.patch.yml       # one insert line: - id: dsh-session-recycle-tools
|- lib/index.js           # host half: an empty apply()
|- client.js              # the two buttons and the two dialogs
|- screenshots.json       # 1-8 storefront screenshots
|- assets/icon-180.png    # 180x180 storefront tile
```

Host capabilities `client.js` relies on:

| Purpose | Source |
| --- | --- |
| Session summaries | `ctx.get('sessions').list` (`ids` / `byId`, including `running`) |
| Workspace grouping | `ctx.get('workspaces').list` (`items[].sessionIds`) |
| Hide and restore | wrap `uiWorkspace.isSessionVisible` and bump `uiWorkspace.sessionVisibility` |
| Permanent delete | `uiWorkspace.deleteSession()` |
| The recycle-bin list | the plugin's own `localStorage` key |
| Registration | `sidebar.footer.action` (a list slot, one row above `sidebar.settings`); dialogs use `shell.overlay` |
| Icons, buttons, checkboxes, dialog | `@deepseek-ai/dsh-client-ui-primitives` |

## The two dialogs

| Entry | Dialog | What it does |
| --- | --- | --- |
| Batch delete | every session, grouped by workspace, with a search box | check sessions (whole group or all), then move them into the recycle bin, which is the only action here |
| Recycle bin | sessions in the list, grouped by workspace, newest first | restore one or all; permanently delete one or empty the bin |

Both dialogs are 1240px wide and follow the application body text: 20px title, 16px description, 16px session title,
14px timestamps and paths, 15px buttons.

## Install

```sh
dsh plugin --profile web add github:Unintendedz/dsh-session-recycle-tools
```

Then restart the running DSH web service. No host tool, route, or configuration is added.

## Compatibility

Requires a DSH build that serves client plugins through `dsh-client-modules` and exposes `uiWorkspace` with
`isSessionVisible`, `sessionVisibility`, and `deleteSession`. If `isSessionVisible` is missing, the plugin still records
the list and says so in the dialog rather than hiding anything silently.
