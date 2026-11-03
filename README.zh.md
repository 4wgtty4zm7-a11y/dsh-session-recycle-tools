# dsh-session-recycle-tools

[English](./README.md) | 中文

给 DeepSeek Harness 侧边栏加两个按键：**批量删除** 和 **回收站**，位置在会话界面左下角、**设置按键正上方**。

```
  ☑  批量删除              ← 本插件
  🗑  回收站              ← 本插件
  ⚙  设置                  ← 原有

```

## 回收站是独立的，不是「归档」

侧边栏自带的「归档」是宿主的能力：它写 `workspaces.archivedSessionIds`，共用同一个「已归档」视图。
本插件的回收站**完全不用它**，两者互不影响：

| | 侧边栏自带「归档」 | 本插件「回收站」 |
| --- | --- | --- |
| 记录在 | 宿主工作区记录 `archivedSessionIds` | 插件自己的名录（`localStorage` 键 `dsh-session-tools.trash.v1`） |
| 隐藏方式 | 宿主按归档标记过滤行 | 在 `uiWorkspace.isSessionVisible` 外面包一层，只有本插件名录里的 id 返回 `false` |
| 恢复 | 取消归档（宿主调用） | 从名录里删 id，会话立刻回到列表 |
| 与对方的关系 | 不知道回收站存在 | 原样保留宿主的过滤结果，只是再与一份自己的集合相与 |

具体实现（`client.js`）：

1. `apply()` 里取到 `ctx.get('uiWorkspace')`，把它的 `isSessionVisible` 换成
   `(id) => trash.has(id) ? false : original(id)`，并在 `ctx.effect` 的清理函数里换回原函数。
   宿主原本的过滤（比如工作台插件注册的 session filter）被 `original(id)` 原样调用，语义不变。
2. 名录变更后递增 `uiWorkspace.sessionVisibility`，侧边栏树据此重算可见行。
3. 移入不发起任何归档请求；**彻底删除** 才调宿主 `uiWorkspace.deleteSession()`，与会话右键菜单的
   「永久删除会话」同一条路径。
4. 正在运行的会话不允许移入（避免它从列表消失却仍在后台跑），面板会单独提示「先停止后再移入」。
5. 名录里的 id 若在会话列表里彻底消失（超过 60 秒宽限），自动清理。

已知代价：名录存在浏览器 localStorage，属于当前 origin（`http://127.0.0.1:<端口>`）。清空站点数据或换端口
后回收站会变空 —— 后果只是那些会话重新出现在列表里，不会丢内容。

## 结构

宿主半侧只有一个 Loader 行，作用仅仅是让 `dsh-client-modules` 扫描到本包的 `dsh.client` 声明并把
`client.js` 送到页面 —— 插件不注册任何 host 服务、路由或工具，模型看不到它。

```
plugin/
├─ package.json           # dsh.client: { platform: 'web' } + dsh.bundle.patch
├─ cordis.patch.yml       # 一行 insert：- id: dsh-session-tools
├─ lib/index.js           # host 半侧：空 apply
├─ client.js              # 两个按键 + 两个面板
└─ README.md
```

`client.js` 用到的宿主能力：

| 用途 | 来源 |
| --- | --- |
| 会话摘要 | `ctx.get('sessions').list`（`ids` / `byId`，含 `running`） |
| 工作区分组 | `ctx.get('workspaces').list`（`items[].sessionIds`） |
| 隐藏 / 恢复 | 包一层 `uiWorkspace.isSessionVisible` + 递增 `uiWorkspace.sessionVisibility` |
| 彻底删除 | `uiWorkspace.deleteSession()` |
| 回收站名录 | 插件自己的 `localStorage` |
| 注册位置 | `sidebar.footer.action`（列表席位，排在 `sidebar.settings` 上一行）；面板走 `shell.overlay` |
| 图标、按钮、复选框、弹窗 | `@deepseek-ai/dsh-client-ui-primitives` |

## 两个面板

| 入口 | 面板 | 能干什么 |
| --- | --- | --- |
| 批量删除 | 全部会话按工作区分组，可搜索 | 勾选（支持整组、全选），**只**能移入回收站 |
| 回收站 | 名录里的会话按工作区分组，按移入时间倒序 | 逐个 / 全部恢复；逐个 / 清空彻底删除 |

都是 1240px 宽，字号对齐应用正文（标题 20px、描述 16px、会话标题 16px、时间与路径 14px、按钮 15px）。

## 安装

```powershell
node scripts/install.mjs          # 部署到 harness/plugins + 软链进 profile + 写入 Loader 行
node scripts/install.mjs --revert # 反向拆除
```

装完不用重启桌面端：profile 的 `cordis.patch.yml` 是被 watch 的，Loader 行会即时生效，页面经
modules 图热加载到插件。**改动 `client.js` 之后需要刷新页面**（Ctrl+R）——桌面端自带的 HMR 只做配置
watch，不做模块级热替换。

## 开发

```powershell
node scripts/test-client.mjs   # 无头冒烟（约 50 项）
```

覆盖：槽位接线、中英词条齐全、移入/恢复/彻底删除的调用与拒绝处理、**移入不发归档请求**、
可见性拦截与原函数的组合和还原、名录持久化与过期清理、两个面板的投影（回收站里有、批量列表里没有）。
测试在 vm 里跑 `client.js`（桩掉 `window.__ModuleLoader__` / `require` / React / localStorage），
渲染由实机验证。
