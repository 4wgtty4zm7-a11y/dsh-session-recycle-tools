/* dsh-session-tools — 会话回收站 + 批量删除
 *
 * 两个入口注册进 `sidebar.footer.action`（侧边栏脚部列表席位），它在
 * `sidebar.settings`（设置按键）所在行的正上方，所以按钮天然长在
 * 「会话界面左下角、设置按键上方」。面板走 `shell.overlay`。
 *
 * 「移入回收站」是本插件自己的软隐藏，跟侧边栏自带的「归档」完全无关：
 *
 *   · 不进宿主的 archivedSessionIds，不动工作区记录，不发任何归档请求；
 *   · 只把会话 id 记进插件自己的回收站名录（localStorage）；
 *   · 通过 uiWorkspace.isSessionVisible 的外包拦一层，让侧边栏树不画这些行；
 *   · 恢复 = 从名录里删掉，会话原样回到列表；
 *   · 彻底删除才调宿主 uiWorkspace.deleteSession()，与会话右键菜单的
 *     「永久删除会话」同一条路径。
 *
 * 断链兜底：宿主没有 isSessionVisible 时只记名录（不隐藏），并在控制台告警，
 * 面板里的恢复/清空仍然可用 —— 不会静默吞掉会话。
 */
window.__ModuleLoader__.load({
	id: 'dsh-session-recycle-tools',
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });

		const React = require('react');
		const h = React.createElement;
		const { useState, useEffect, useMemo, useCallback } = React;
		const P = require('@deepseek-ai/dsh-client-ui-primitives');

		const NS = 'session-tools';
		const STYLE_ID = 'dsh-session-tools-style';
		const TRASH_KEY = 'dsh-session-tools.trash.v1';
		/** A trashed id missing from the list is only pruned after this grace. */
		const PRUNE_GRACE_MS = 60_000;

		/* ───────────────────────────── locale ───────────────────────────── */

		const zh = {
			'btn.trash': '回收站',
			'btn.batch': '批量删除',
			'trash.title': '回收站',
			'trash.desc': '本插件自己的回收站，和侧边栏自带的「归档」互不影响。这里的会话只是从列表隐藏，内容仍在磁盘上；恢复即回到列表，彻底删除无法撤销。',
			'trash.empty': '回收站是空的',
			'trash.emptyHint': '在「批量删除」里把会话移入回收站，它们会出现在这里。',
			'trash.summary': '共 {n} 个会话',
			'trash.restore': '恢复',
			'trash.purge': '彻底删除',
			'trash.restoreAll': '全部恢复',
			'trash.emptyAll': '清空回收站',
			'trash.confirmEmpty': '再次确认清空',
			'trash.restored': '已恢复 {n} 个会话',
			'trash.purged': '已彻底删除 {n} 个会话',
			'trash.trashedAt': '移入 {time}',
			'trash.hiddenUnavailable': '宿主没有提供会话可见性接口，回收站只能记录、不能隐藏。',
			'batch.title': '批量删除会话',
			'batch.desc': '勾选后移入本插件自己的回收站（不是归档，可随时恢复）；彻底删除只在回收站里进行。',
			'batch.search': '搜索会话…',
			'batch.all': '全选',
			'batch.none': '取消全选',
			'batch.selected': '已选 {n} 个',
			'batch.trash': '移入回收站',
			'batch.trashed': '已移入回收站 {n} 个会话',
			'batch.skippedRunning': '{n} 个会话正在运行，先停止后再移入',
			'batch.needPick': '先勾选会话',
			'batch.empty': '没有可操作的会话',
			'batch.loading': '正在读取会话…',
			'tag.running': '运行中',
			'tag.blank': '空会话',
			'group.ungrouped': '未分组',
			'failed': '{n} 个会话失败：{message}',
			'common.close': '关闭',
			'common.cancel': '取消',
		};

		const en = {
			'btn.trash': 'Recycle bin',
			'btn.batch': 'Batch delete',
			'trash.title': 'Recycle bin',
			'trash.desc': "This plugin's own recycle bin, independent of the sidebar's Archive. Sessions here are only hidden from the list and keep their content on disk; restoring puts them back, permanent delete cannot be undone.",
			'trash.empty': 'The recycle bin is empty',
			'trash.emptyHint': 'Move sessions here from “Batch delete” and they show up in this list.',
			'trash.summary': '{n} sessions',
			'trash.restore': 'Restore',
			'trash.purge': 'Delete forever',
			'trash.restoreAll': 'Restore all',
			'trash.emptyAll': 'Empty recycle bin',
			'trash.confirmEmpty': 'Confirm empty',
			'trash.restored': 'Restored {n} sessions',
			'trash.purged': 'Permanently deleted {n} sessions',
			'trash.trashedAt': 'trashed {time}',
			'trash.hiddenUnavailable': 'The host exposes no session visibility hook, so the recycle bin can record but not hide sessions.',
			'batch.title': 'Batch delete sessions',
			'batch.desc': "Move picked sessions into this plugin's own recycle bin (not Archive, fully restorable). Permanent delete happens in the recycle bin only.",
			'batch.search': 'Search sessions…',
			'batch.all': 'Select all',
			'batch.none': 'Clear selection',
			'batch.selected': '{n} selected',
			'batch.trash': 'Move to recycle bin',
			'batch.trashed': 'Moved {n} sessions to the recycle bin',
			'batch.skippedRunning': '{n} running sessions — stop them before moving',
			'batch.needPick': 'Select a session first',
			'batch.empty': 'No session to act on',
			'batch.loading': 'Reading sessions…',
			'tag.running': 'running',
			'tag.blank': 'empty',
			'group.ungrouped': 'Ungrouped',
			'failed': '{n} sessions failed: {message}',
			'common.close': 'Close',
			'common.cancel': 'Cancel',
		};

		/* ────────────────────────────── styles ──────────────────────────── */

		const CSS = `
.dst-rows{display:flex;flex-direction:column;width:100%;min-width:0;margin:2px 0 4px}
.dst-row{display:flex;align-items:center;gap:8px;width:100%;min-width:0}
.dst-btn{box-sizing:border-box;display:flex;flex:1 1 auto;align-items:center;gap:8px;min-width:0;height:42px;margin:0;padding:0 10px 0 8px;border:none;border-radius:var(--dsw-radius-md);background:transparent;color:var(--dsw-alias-label-primary);font-family:inherit;font-size:14px;line-height:22px;text-align:left;cursor:pointer;overflow:hidden}
.dst-btn:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dst-btn:active{background:var(--dsw-alias-interactive-bg-active)}
.dst-btn:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:-2px}
.dst-btn[data-active="true"]{background:var(--dsw-alias-interactive-bg-hover)}
.dst-btn > svg{flex:none}
.dst-label{flex:1 1 auto;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
[data-dsh-sidebar-wide="false"] .dst-rows{width:auto;align-items:center}
[data-dsh-sidebar-wide="false"] .dst-btn{flex:none;justify-content:center;gap:0;width:36px;height:36px;padding:0}
[data-dsh-sidebar-wide="false"] .dst-label{display:none}
.dst-dialog.dst-dialog{width:min(1240px,100%)}
/* 面板字号对齐应用正文基准（18px）：标题 20 / 描述 16 / 会话标题 16 / 次要信息 14。 */
.dst-dialog.dst-dialog h2{font-size:20px;line-height:28px}
.dst-dialog.dst-dialog p{font-size:16px;line-height:24px}
.dst-dialog.dst-dialog button{font-size:15px;line-height:22px}
.dst-toolbar{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:12px}
.dst-search{box-sizing:border-box;flex:1 1 220px;min-width:140px;height:38px;padding:0 12px;border:0.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-md);background:transparent;color:var(--dsw-alias-label-primary);font-family:inherit;font-size:15px;line-height:24px}
.dst-search:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:1px}
.dst-count{font-size:14px;line-height:20px;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums}
.dst-list{display:flex;flex-direction:column;gap:16px;max-height:min(820px,calc(100vh - 400px));overflow:auto;padding-right:2px}
.dst-group{display:flex;flex-direction:column;gap:2px}
.dst-group-head{display:flex;align-items:center;gap:8px;padding:2px 2px 6px;font-size:14px;line-height:20px;color:var(--dsw-alias-label-secondary);border-bottom:0.5px solid var(--dsw-alias-border-l2);margin-bottom:4px}
.dst-group-label{flex:1 1 auto;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dst-item{display:flex;align-items:center;gap:10px;padding:7px 8px 7px 10px;border-radius:var(--dsw-radius-md);min-width:0}
.dst-item:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dst-item-main{flex:1 1 auto;min-width:0;display:flex;flex-direction:column;gap:3px;cursor:pointer}
.dst-item-title{display:flex;align-items:center;gap:8px;min-width:0;font-size:16px;line-height:24px;color:var(--dsw-alias-label-primary)}
.dst-item-title > span:first-child{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dst-item-meta{font-size:14px;line-height:20px;color:var(--dsw-alias-label-caption,var(--dsw-alias-label-secondary));overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dst-item-ops{display:flex;flex:none;align-items:center;gap:8px}
.dst-tag{flex:none;padding:0 8px;height:20px;line-height:20px;border-radius:10px;font-size:12px;background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary)}
.dst-empty{display:flex;flex-direction:column;align-items:center;gap:8px;padding:40px 8px;text-align:center;color:var(--dsw-alias-label-secondary)}
.dst-empty b{font-size:17px;font-weight:500;color:var(--dsw-alias-label-primary)}
.dst-empty span{font-size:14px;line-height:20px}
.dst-status{display:flex;align-items:flex-start;gap:6px;margin-top:12px;font-size:14px;line-height:20px;color:var(--dsw-alias-label-secondary)}
.dst-status[data-kind="ok"]{color:var(--dsw-alias-state-success-primary,var(--dsw-alias-label-secondary))}
.dst-status[data-kind="warn"]{color:var(--dsw-alias-state-warning-primary,var(--dsw-alias-label-secondary))}
.dst-status[data-kind="error"]{color:var(--dsw-alias-state-error-primary,var(--dsw-alias-label-secondary))}
.dst-danger{color:var(--dsw-alias-state-error-primary,#e05a5a)!important}
.dst-footer{display:flex;flex-wrap:wrap;align-items:center;gap:8px;width:100%;justify-content:flex-end}
.dst-footer-gap{flex:1 1 auto}
`;

		/* ───────────────────────── store plumbing ───────────────────────── */

		/** Minimal external store: enough for a two-value view switch. */
		function createStore(initial) {
			let value = initial;
			const listeners = new Set();
			return {
				get: () => value,
				set: (next) => {
					const resolved = typeof next === 'function' ? next(value) : next;
					if (resolved === value) return;
					value = resolved;
					listeners.forEach((fn) => {
						try {
							fn();
						} catch {
							/* a broken listener must not block the others */
						}
					});
				},
				subscribe: (fn) => {
					listeners.add(fn);
					return () => listeners.delete(fn);
				},
			};
		}

		/** Read my own store reactively. */
		function useStoreValue(store) {
			const [value, setValue] = useState(() => store.get());
			useEffect(() => {
				const sync = () => setValue(store.get());
				sync();
				return store.subscribe(sync);
			}, [store]);
			return value;
		}

		/** Read a framework snapshot store (`getSnapshot`/`subscribe`) reactively. */
		function useSnapshot(store) {
			const [value, setValue] = useState(() => (store ? store.getSnapshot() : undefined));
			useEffect(() => {
				if (!store) return undefined;
				const sync = () => setValue(store.getSnapshot());
				sync();
				return store.subscribe(sync);
			}, [store]);
			return value;
		}

		/* ─────────────────────────── trash registry ─────────────────────── */

		/** Read the persisted membership map: `{ [sessionId]: trashedAt }`. */
		function readTrash() {
			try {
				const raw = window.localStorage.getItem(TRASH_KEY);
				if (!raw) return {};
				const parsed = JSON.parse(raw);
				if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
				const entries = {};
				for (const [id, at] of Object.entries(parsed)) {
					if (typeof id !== 'string' || id === '') continue;
					entries[id] = Number.isFinite(at) ? at : Date.now();
				}
				return entries;
			} catch {
				return {};
			}
		}

		/**
		 * The recycle-bin membership set.
		 *
		 * Kept beside the host's own state on purpose: this is the one thing the
		 * plugin owns, so archiving a session and trashing it never share a
		 * mechanism. `getSnapshot()`/`subscribe()` make it readable through the
		 * same hook shape as the framework stores.
		 */
		function createTrashStore() {
			let entries = readTrash();
			let version = 0;
			const listeners = new Set();
			const persist = () => {
				try {
					window.localStorage.setItem(TRASH_KEY, JSON.stringify(entries));
				} catch {
					/* private mode / quota: the session still behaves this run */
				}
			};
			const emit = () => {
				version += 1;
				for (const fn of [...listeners]) {
					try {
						fn();
					} catch {
						/* keep notifying the rest */
					}
				}
			};
			const store = {
				getSnapshot: () => version,
				subscribe: (fn) => {
					listeners.add(fn);
					return () => listeners.delete(fn);
				},
				has: (id) => Object.prototype.hasOwnProperty.call(entries, id),
				at: (id) => entries[id] || 0,
				ids: () => Object.keys(entries),
				count: () => Object.keys(entries).length,
				add(ids) {
					const now = Date.now();
					let changed = false;
					for (const id of ids) {
						if (store.has(id)) continue;
						entries[id] = now;
						changed = true;
					}
					if (changed) {
						persist();
						emit();
					}
					return changed;
				},
				remove(ids) {
					let changed = false;
					for (const id of ids) {
						if (!store.has(id)) continue;
						delete entries[id];
						changed = true;
					}
					if (changed) {
						persist();
						emit();
					}
					return changed;
				},
				prune(known) {
					const now = Date.now();
					const gone = Object.keys(entries).filter((id) => !known.has(id) && now - (entries[id] || 0) > PRUNE_GRACE_MS);
					if (gone.length > 0) store.remove(gone);
				},
			};
			return store;
		}

		/* ──────────────────────── session projection ────────────────────── */

		function errorText(error) {
			if (!error) return '';
			if (error instanceof Error) return error.message;
			if (typeof error === 'string') return error;
			try {
				return JSON.stringify(error);
			} catch {
				return String(error);
			}
		}

		function timeText(stamp) {
			const ms = typeof stamp === 'number' ? stamp : Date.parse(stamp);
			if (!Number.isFinite(ms)) return '';
			try {
				return new Date(ms).toLocaleString(undefined, {
					month: '2-digit',
					day: '2-digit',
					hour: '2-digit',
					minute: '2-digit',
				});
			} catch {
				return new Date(ms).toISOString().slice(5, 16).replace('T', ' ');
			}
		}

		function titleOf(summary) {
			if (!summary) return '';
			const raw = typeof summary.title === 'string' ? summary.title.trim() : '';
			if (raw !== '') return raw;
			const display = typeof summary.displayTitle === 'string' ? summary.displayTitle.trim() : '';
			return display;
		}

		/**
		 * Project the Session list into workspace groups.
		 *
		 * A Session belongs to the group whose `sessionIds` names it; anything a
		 * group does not account for trails in an Ungrouped section, exactly like
		 * the browser derives its own tree. Subagent children are not ordinary
		 * sessions and never enter this list. `isTrashed` marks the plugin's own
		 * recycle-bin membership without touching the host's archive set.
		 */
		function buildGroups(sessions, workspaces, isTrashed) {
			const byId = (sessions && sessions.byId) || {};
			const archived = new Set((workspaces && workspaces.archivedSessionIds) || []);
			const items = (workspaces && workspaces.items) || [];
			const trashed = typeof isTrashed === 'function' ? isTrashed : () => false;
			const toRow = (id) => {
				const summary = byId[id];
				if (!summary) return null;
				if (summary.origin === 'subagent') return null;
				return {
					id,
					title: titleOf(summary),
					blank: summary.blank === true,
					running: summary.running === true,
					archived: archived.has(id),
					trashed: trashed(id) === true,
					updatedAt: summary.updatedAt,
					cwd: summary.cwd,
				};
			};
			const groups = [];
			const accounted = new Set();
			for (const group of items) {
				const rows = [];
				for (const id of group.sessionIds || []) {
					accounted.add(id);
					const row = toRow(id);
					if (row) rows.push(row);
				}
				groups.push({
					key: group.workspaceId || '',
					label: group.title || group.path || group.workspaceId || '',
					cwd: group.path,
					rows,
				});
			}
			const stray = [];
			for (const id of (sessions && sessions.ids) || []) {
				if (accounted.has(id)) continue;
				const row = toRow(id);
				if (row) stray.push(row);
			}
			if (stray.length > 0) groups.push({ key: '', label: '', cwd: undefined, rows: stray });
			return groups;
		}

		function countRows(groups, pick) {
			let total = 0;
			for (const group of groups) for (const row of group.rows) if (pick(row)) total += 1;
			return total;
		}

		/** Group rows by workspace, keeping only the recyclable ones, newest first. */
		function trashGroups(sessions, workspaces, trash) {
			if (!sessions || !workspaces) return [];
			return buildGroups(sessions, workspaces, (id) => trash.has(id))
				.map((group) => ({
					...group,
					rows: group.rows
						.filter((row) => row.trashed)
						.sort((left, right) => trash.at(right.id) - trash.at(left.id)),
				}))
				.filter((group) => group.rows.length > 0);
		}

		/* ───────────────────────────── footer ───────────────────────────── */

		/**
		 * The two sidebar-foot entries. No counter and no badge: the row stays a
		 * plain icon+label like the settings trigger below it.
		 */
		function FooterActions(props) {
			const { wide, t, ui, actions } = props;
			const view = useStoreValue(ui).view;
			const button = (kind, label, icon) => {
				const node = h(
					'button',
					{
						type: 'button',
						className: 'dst-btn',
						'aria-label': label,
						'aria-haspopup': 'dialog',
						'aria-expanded': view === kind ? 'true' : 'false',
						'data-active': view === kind ? 'true' : 'false',
						onClick: () => {
							if (view === kind) actions.close();
							else actions.open(kind);
						},
					},
					icon,
					h('span', { className: 'dst-label' }, label),
				);
				const tip = h(P.Tooltip, { label, delayMs: 400, disabled: wide === true, side: 'right' }, node);
				return h('div', { className: 'dst-row', key: kind }, tip);
			};
			return h(
				'div',
				{ className: 'dst-rows', 'data-dsh-session-tools': 'footer' },
				// 批量删除在上、回收站在下（紧挨设置行）。
				button('batch', t('btn.batch'), h(P.IconChecklistOutlineRegular, { size: wide === false ? 18 : 16 })),
				button('trash', t('btn.trash'), h(P.IconTrashOutlineRegular, { size: wide === false ? 18 : 16 })),
			);
		}

		/* ──────────────────────────── trash view ────────────────────────── */

		function TrashView(props) {
			const { t, actions, sessionsList, workspacesList, trash } = props;
			const sessions = useSnapshot(sessionsList);
			const workspaces = useSnapshot(workspacesList);
			const trashVersion = useSnapshot(trash);
			const [busy, setBusy] = useState(false);
			const [armed, setArmed] = useState(false);
			const [status, setStatus] = useState(null);

			const groups = useMemo(
				() => trashGroups(sessions, workspaces, trash),
				[sessions, workspaces, trash, trashVersion],
			);
			const total = countRows(groups, () => true);
			const allIds = useMemo(() => groups.flatMap((group) => group.rows.map((row) => row.id)), [groups]);

			useEffect(() => {
				if (armed) setArmed(false);
				// A new target set retires the pending “empty” confirmation.
			}, [total]);

			const report = (result, doneKey) => {
				const parts = [];
				if (result.done.length > 0) parts.push({ kind: 'ok', text: t(doneKey, { n: result.done.length }) });
				if (result.failed.length > 0) {
					parts.push({ kind: 'error', text: t('failed', { n: result.failed.length, message: errorText(result.failed[0].error) }) });
				}
				setStatus(parts.length > 0 ? parts : null);
			};

			const restore = async (ids) => {
				if (ids.length === 0 || busy) return;
				setBusy(true);
				try {
					report(await actions.restore(ids), 'trash.restored');
				} finally {
					setBusy(false);
				}
			};

			const purge = async (ids) => {
				if (ids.length === 0 || busy) return;
				setBusy(true);
				try {
					report(await actions.purge(ids), 'trash.purged');
					setArmed(false);
				} finally {
					setBusy(false);
				}
			};

			const body = h(
				'div',
				null,
				total === 0
					? h(
							'div',
							{ className: 'dst-empty' },
							h(P.IconTrashOutlineRegular, { size: 22 }),
							h('b', null, t('trash.empty')),
							h('span', null, t('trash.emptyHint')),
						)
					: h(
							'div',
							{ className: 'dst-list' },
							groups.map((group) =>
								h(
									'div',
									{ className: 'dst-group', key: group.key || '__ungrouped' },
									h(
										'div',
										{ className: 'dst-group-head' },
										h('span', { className: 'dst-group-label' }, group.label || t('group.ungrouped')),
										h('span', { className: 'dst-count' }, String(group.rows.length)),
									),
									group.rows.map((row) =>
										h(
											'div',
											{ className: 'dst-item', key: row.id },
											h(
												'div',
												{ className: 'dst-item-main' },
												h(
													'div',
													{ className: 'dst-item-title' },
													h('span', null, row.title || row.id),
													row.blank ? h('span', { className: 'dst-tag' }, t('tag.blank')) : null,
													row.running ? h('span', { className: 'dst-tag' }, t('tag.running')) : null,
												),
												h('div', { className: 'dst-item-meta' }, t('trash.trashedAt', { time: timeText(trash.at(row.id)) })),
											),
											h(
												'div',
												{ className: 'dst-item-ops' },
												h(
													P.Button,
													{
														variant: 'outline',
														size: 'md',
														disabled: busy,
														onClick: () => restore([row.id]),
													},
													t('trash.restore'),
												),
												h(
													P.Button,
													{
														variant: 'ghost',
														size: 'md',
														className: 'dst-danger',
														disabled: busy,
														onClick: () => purge([row.id]),
													},
													t('trash.purge'),
												),
											),
										),
									),
								),
							),
						),
				status
					? status.map((line, index) =>
							h('div', { className: 'dst-status', 'data-kind': line.kind, key: index }, line.text),
						)
					: null,
			);

			const footer = h(
				'div',
				{ className: 'dst-footer' },
				total > 0 ? h('span', { className: 'dst-count' }, t('trash.summary', { n: total })) : null,
				h('span', { className: 'dst-footer-gap' }),
				total > 0
					? h(
							P.Button,
							{ variant: 'ghost', size: 'md', disabled: busy, onClick: () => restore(allIds) },
							t('trash.restoreAll'),
						)
					: null,
				total > 0
					? h(
							P.Button,
							{
								variant: armed ? 'primary' : 'outline',
								size: 'md',
								className: armed ? undefined : 'dst-danger',
								disabled: busy,
								onClick: () => {
									if (!armed) {
										setArmed(true);
										return;
									}
									purge(allIds);
								},
							},
							armed ? t('trash.confirmEmpty') : t('trash.emptyAll'),
						)
					: null,
				h(P.Button, { variant: 'ghost', size: 'md', onClick: actions.close }, t('common.close')),
			);

			return h(P.Modal, {
				open: true,
				onClose: actions.close,
				title: t('trash.title'),
				closeLabel: t('common.close'),
				description: t('trash.desc'),
				className: 'dst-dialog',
				footer,
				children: body,
			});
		}

		/* ──────────────────────────── batch view ────────────────────────── */

		function BatchView(props) {
			const { t, actions, sessionsList, workspacesList, trash } = props;
			const sessions = useSnapshot(sessionsList);
			const workspaces = useSnapshot(workspacesList);
			const trashVersion = useSnapshot(trash);
			const [selected, setSelected] = useState(() => new Set());
			const [query, setQuery] = useState('');
			const [busy, setBusy] = useState(false);
			const [status, setStatus] = useState(null);

			const groups = useMemo(() => {
				if (!sessions || !workspaces) return [];
				const needle = query.trim().toLowerCase();
				return buildGroups(sessions, workspaces, (id) => trash.has(id))
					.map((group) => ({
						...group,
						rows: group.rows
							// 回收站里的、归档的、以及占位空会话都不进批量列表。
							.filter((row) => !row.trashed && !row.archived && !row.blank)
							.filter((row) => (needle === '' ? true : `${row.title} ${row.id} ${row.cwd || ''}`.toLowerCase().includes(needle))),
					}))
					.filter((group) => group.rows.length > 0);
			}, [sessions, workspaces, trash, trashVersion, query]);

			const visibleIds = useMemo(() => groups.flatMap((group) => group.rows.map((row) => row.id)), [groups]);
			const pickedIds = useMemo(() => visibleIds.filter((id) => selected.has(id)), [visibleIds, selected]);
			const allPicked = visibleIds.length > 0 && pickedIds.length === visibleIds.length;
			const trashedCount = trashVersion === undefined ? 0 : trash.count();

			const toggle = useCallback((id, next) => {
				setSelected((previous) => {
					const copy = new Set(previous);
					if (next) copy.add(id);
					else copy.delete(id);
					return copy;
				});
			}, []);

			const toggleAll = useCallback(
				(next) => {
					setSelected((previous) => {
						const copy = new Set(previous);
						for (const id of visibleIds) {
							if (next) copy.add(id);
							else copy.delete(id);
						}
						return copy;
					});
				},
				[visibleIds],
			);

			const move = async (ids) => {
				if (ids.length === 0 || busy) return;
				setBusy(true);
				try {
					const result = await actions.trash(ids);
					if (result.done.length > 0) {
						setSelected((previous) => {
							const copy = new Set(previous);
							for (const id of result.done) copy.delete(id);
							return copy;
						});
					}
					const lines = [];
					if (result.done.length > 0) lines.push({ kind: 'ok', text: t('batch.trashed', { n: result.done.length }) });
					if (result.skipped.length > 0) lines.push({ kind: 'warn', text: t('batch.skippedRunning', { n: result.skipped.length }) });
					if (result.failed.length > 0) {
						lines.push({ kind: 'error', text: t('failed', { n: result.failed.length, message: errorText(result.failed[0].error) }) });
					}
					setStatus(lines.length > 0 ? lines : null);
				} finally {
					setBusy(false);
				}
			};

			const onMove = () => {
				if (pickedIds.length === 0) {
					setStatus([{ kind: 'warn', text: t('batch.needPick') }]);
					return;
				}
				move(pickedIds);
			};

			const loading = !sessions || !workspaces;

			const body = h(
				'div',
				null,
				h(
					'div',
					{ className: 'dst-toolbar' },
					h('input', {
						type: 'search',
						className: 'dst-search',
						placeholder: t('batch.search'),
						value: query,
						onChange: (event) => setQuery(event.target.value),
					}),
					h(
						P.Button,
						{ variant: 'outline', size: 'md', disabled: visibleIds.length === 0, onClick: () => toggleAll(!allPicked) },
						allPicked ? t('batch.none') : t('batch.all'),
					),
					h('span', { className: 'dst-count' }, t('batch.selected', { n: pickedIds.length })),
				),
				loading
					? h('div', { className: 'dst-empty' }, h('span', null, t('batch.loading')))
					: groups.length === 0
						? h('div', { className: 'dst-empty' }, h(P.IconChecklistOutlineRegular, { size: 22 }), h('b', null, t('batch.empty')))
						: h(
								'div',
								{ className: 'dst-list' },
								groups.map((group) => {
									const groupIds = group.rows.map((row) => row.id);
									const groupAll = groupIds.every((id) => selected.has(id));
									return h(
										'div',
										{ className: 'dst-group', key: group.key || '__ungrouped' },
										h(
											'div',
											{ className: 'dst-group-head' },
											h(
												P.Checkbox,
												{
													checked: groupAll,
													onChange: (next) => {
														setSelected((previous) => {
															const copy = new Set(previous);
															for (const id of groupIds) {
																if (next) copy.add(id);
																else copy.delete(id);
															}
															return copy;
														});
													},
													label: '',
												},
											),
											h('span', { className: 'dst-group-label' }, group.label || t('group.ungrouped')),
											h('span', { className: 'dst-count' }, String(group.rows.length)),
										),
										group.rows.map((row) =>
											h(
												'div',
												{ className: 'dst-item', key: row.id },
												h(P.Checkbox, {
													checked: selected.has(row.id),
													onChange: (next) => toggle(row.id, next),
													label: '',
												}),
												h(
													'div',
													{
														className: 'dst-item-main',
														onClick: () => toggle(row.id, !selected.has(row.id)),
													},
													h(
														'div',
														{ className: 'dst-item-title' },
														h('span', null, row.title || row.id),
														row.running ? h('span', { className: 'dst-tag' }, t('tag.running')) : null,
													),
													h(
														'div',
														{ className: 'dst-item-meta' },
														[timeText(row.updatedAt), row.cwd].filter((part) => !!part).join('  ·  '),
													),
												),
											),
										),
									);
								}),
							),
				status ? status.map((line, index) => h('div', { className: 'dst-status', 'data-kind': line.kind, key: index }, line.text)) : null,
			);

			const footer = h(
				'div',
				{ className: 'dst-footer' },
				trashedCount > 0
					? h(
							P.Button,
							{ variant: 'ghost', size: 'md', onClick: () => actions.open('trash') },
							`${t('btn.trash')} · ${trashedCount}`,
						)
					: null,
				h('span', { className: 'dst-footer-gap' }),
				h(P.Button, { variant: 'ghost', size: 'md', onClick: actions.close }, t('common.cancel')),
				h(
					P.Button,
					{ variant: 'primary', size: 'md', disabled: busy, onClick: onMove },
					t('batch.trash'),
				),
			);

			return h(P.Modal, {
				open: true,
				onClose: actions.close,
				title: t('batch.title'),
				closeLabel: t('common.close'),
				description: t('batch.desc'),
				className: 'dst-dialog',
				footer,
				children: body,
			});
		}

		/* ───────────────────────────── overlay ──────────────────────────── */

		function PanelRoot(props) {
			const view = useStoreValue(props.ui).view;
			if (view === 'trash') return h(TrashView, props);
			if (view === 'batch') return h(BatchView, props);
			return null;
		}

		/* ────────────────────────────── plugin ──────────────────────────── */

		const inject = ['slots', 'locale', 'sessions', 'workspaces', 'uiWorkspace'];

		function apply(ctx) {
			const t = ctx.locale.bind(NS);
			ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-session-tools: dictionaries');
			ctx.effect(() => {
				if (document.getElementById(STYLE_ID)) return undefined;
				const tag = document.createElement('style');
				tag.id = STYLE_ID;
				tag.textContent = CSS;
				document.head.appendChild(tag);
				return () => tag.remove();
			}, 'dsh-session-tools: styles');

			const nav = ctx.get('uiWorkspace');
			const sessions = ctx.get('sessions');
			const workspaces = ctx.get('workspaces');
			if (!nav || !sessions || !workspaces) {
				console.warn('[dsh-session-tools] session services unavailable; footer entries skipped');
				return;
			}

			const ui = createStore({ view: null });
			const trash = createTrashStore();

			/* Hide trashed sessions from the sidebar tree without touching the
			 * host's archive set. `isSessionVisible` is the public seam the
			 * workspace browser filters rows through; wrapping it (and restoring
			 * the original on dispose) keeps archive semantics untouched. */
			const visibility = nav.sessionVisibility;
			const invalidateVisibility = () => {
				if (!visibility || typeof visibility.getSnapshot !== 'function' || typeof visibility.set !== 'function') return;
				visibility.set(visibility.getSnapshot() + 1);
			};
			const originalVisible = typeof nav.isSessionVisible === 'function' ? nav.isSessionVisible.bind(nav) : null;
			if (originalVisible === null) {
				console.warn('[dsh-session-tools] uiWorkspace.isSessionVisible is unavailable: trashed sessions stay visible');
			} else {
				const wrapped = (sessionId) => (trash.has(sessionId) ? false : originalVisible(sessionId));
				try {
					Object.defineProperty(nav, 'isSessionVisible', { value: wrapped, configurable: true, writable: true });
				} catch (error) {
					console.warn('[dsh-session-tools] cannot wrap isSessionVisible:', error);
				}
				ctx.effect(
					() => () => {
						try {
							Object.defineProperty(nav, 'isSessionVisible', { value: originalVisible, configurable: true, writable: true });
						} catch { /* the service is gone with the plugin anyway */ }
						invalidateVisibility();
					},
					'dsh-session-tools: release session visibility',
				);
			}
			ctx.effect(() => {
				invalidateVisibility();
				return trash.subscribe(invalidateVisibility);
			}, 'dsh-session-tools: refresh session visibility');

			/* Drop entries whose session no longer exists anywhere. A partial list
			 * during (re)connect cannot erase a fresh entry thanks to the grace. */
			ctx.effect(
				() =>
					sessions.list.subscribe(() => {
						const snapshot = sessions.list.getSnapshot();
						if (!snapshot || !Array.isArray(snapshot.ids)) return;
						trash.prune(new Set(snapshot.ids));
					}),
				'dsh-session-tools: prune the recycle bin',
			);

			const actions = {
				open: (view) => ui.set({ view }),
				close: () => ui.set({ view: null }),
				/** Move sessions into the plugin's own recycle bin (hide, never archive). */
				trash: async (ids) => {
					const snapshot = sessions.list.getSnapshot() || {};
					const byId = snapshot.byId || {};
					const done = [];
					const skipped = [];
					const failed = [];
					for (const id of ids) {
						const summary = byId[id];
						if (!summary) {
							failed.push({ id, error: new Error('会话已不存在') });
							continue;
						}
						if (summary.running === true) {
							skipped.push({ id, reason: 'running' });
							continue;
						}
						done.push(id);
					}
					if (done.length > 0) trash.add(done);
					return { done, skipped, failed };
				},
				/** Put sessions back in the list. Nothing on the host changes. */
				restore: async (ids) => {
					trash.remove(ids);
					return { done: [...ids], skipped: [], failed: [] };
				},
				/** Delete the durable session record, then drop the membership. */
				purge: async (ids) => {
					const done = [];
					const failed = [];
					for (const id of ids) {
						try {
							await nav.deleteSession(id);
							done.push(id);
						} catch (error) {
							failed.push({ id, error });
						}
					}
					if (done.length > 0) trash.remove(done);
					return { done, skipped: [], failed };
				},
			};

			const data = () => ({
				t,
				ui,
				actions,
				trash,
				sessionsList: sessions.list,
				workspacesList: workspaces.list,
			});

			ctx.slots.inject('sidebar.footer.action', () =>
				ctx.slots.register(
					{
						name: 'sidebar.footer.action',
						id: 'dsh-session-recycle-tools',
						order: 50,
						locale: NS,
						inject: data,
					},
					FooterActions,
				),
			);

			ctx.slots.inject('shell.overlay', () =>
				ctx.slots.register(
					{
						name: 'shell.overlay',
						id: 'dsh-session-recycle-tools-panel',
						order: 60,
						locale: NS,
						inject: data,
					},
					PanelRoot,
				),
			);
		}

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	},
});
