<p align="center">
  <img src="assets/icon.svg" width="96" height="96" alt="dsh-tui-plugin-update 标志：蓝色圆角方块上的白色更新箭头">
</p>

# dsh-tui-plugin-update

> 适用于 [dsh-TUI](https://github.com/ccch1mneyyy/dsh-TUI)（[dshtui.com](https://dshtui.com)）的社区插件。

给 **dsh-TUI** 的 `/plugin` 命令加上 `update` 子命令：

```
/plugin update              # 打开选择列表：所有已安装插件 +「全部更新」
/plugin update <插件名>      # 更新指定插件
/plugin update all           # 全部更新
```

不带参数时会弹出一个选择浮层，列出当前 profile 里安装的所有插件，最后一行是 **⬆ 全部更新**。本地 `link:` / `file:` 插件会显示但跳过（没有远程版本可拉）。

> dsh-tui 本体不在这个列表里；更新本体仍用 dsh-tui 自己的 `/update`。

还自带一个等价命令 `/plugin-update`，即使宿主补丁暂时没生效也能用：

```
/plugin-update               # 同一个选择器
/plugin-update status        # 查看插件列表与 /plugin update 别名状态
/plugin-update patch         # 写入 /plugin update 别名（之后重启 dsh-tui）
```

---

## 安装

**先退出正在运行的 dsh-tui**（安装会改 profile 依赖和 dsh-tui 的两个模块），然后在终端执行：

```powershell
cd D:\Project\ds-plugin-update
node scripts\install.mjs --profile dsh-tui
```

安装脚本做三件事：

1. `dsh plugin --profile dsh-tui add D:\Project\ds-plugin-update`，把插件挂进 profile；
2. 给该 profile 实际加载的 `@deepseek-harness-tui/dsh-tui` 写入一个很小的 `/plugin update` 路由补丁；
3. 打印下一步。

然后重新启动 dsh-tui 即可：

```
/plugin update
```

> 默认 profile 是 `dsh-tui`，也可以用 `--profile <名称>` 指定。
> 只想先看看会发生什么：`node scripts\install.mjs --dry-run`。
> 不想写宿主补丁、只用 `/plugin-update`：加 `--no-patch`。

### 手动安装（等价）

```powershell
dsh plugin --profile dsh-tui add D:\Project\ds-plugin-update
node scripts\patch.mjs apply --profile dsh-tui
# 重启 dsh-tui
```

### 卸载

```powershell
node scripts\uninstall.mjs --profile dsh-tui
```

会先还原 dsh-tui 的两个文件，再从 profile 移除插件。之后重启。

---

## 为什么需要宿主补丁？

dsh-TUI 的 `/plugin` 不是 `ctx.commands` 里的命令，而是 Chat 屏幕里的一个 `switch` + 一个报告函数；它也**没有公开“给内置命令加子命令”的扩展点**。因此任何纯外部插件都无法单独把 `update` 塞进 `/plugin`。

这个插件的做法是把宿主改动压到最小、并且可逆：

| 文件 | 改动 |
| --- | --- |
| `lib/types/dsh-adapter/plugins-info.js` | `parsePluginArgs` 认识 `update`；`pluginReport` 把 `update` 转发到插件发布的 bridge |
| `lib/types/dsh-adapter/channel/command-completions.js` | `/plugin` 的补全里出现 `update`；`/plugin update ` 后补全 `all` + 已安装插件名 |

所有选择器、profile 读取、pnpm 调用、结果渲染都在插件里；宿主只负责“把 `update` 这一条路由过来”。补丁锚点在 **dsh-TUI 0.16.1 和 0.17.0** 上一致，写入前会逐条校验锚点，不匹配就拒绝写入而不是写半截；`scripts/patch.mjs remove` 可按原文精确还原。

dsh-TUI 升级会覆盖这两个文件。升级后启动时会收到一次提示：

```
dsh-tui <版本> 的 /plugin update 别名还没写入：运行 /plugin-update patch，然后重启 dsh-tui。
```

`/plugin-update` 本身不受影响；运行 `/plugin-update patch`（或重跑安装脚本）即可恢复别名。

---

## 更新语义

更新走的是官方 CLI 路径：

```sh
dsh plugin --profile <profile> update --latest <插件名...>
```

- `--latest`：即使是 `@scope/pkg@1.2.3` 这种精确版本也会更新到最新发布版；Git 依赖会重新解析远端。
- `dsh plugin` 自带 profile 锁和 peer/DSH 版本兼容检查；不兼容的新版本会被拒绝。
- 本地 `link:` / `file:` / `workspace:` 依赖没有远程版本，选择器里会标注“本地链接，跳过更新”，`全部更新` 会自动跳过。
- 更新会改动 profile 的 `package.json` / `pnpm-lock.yaml`，**通常需要重启 dsh-tui** 才能加载新版本；如果开着热重载，部分插件可能自动接管。
- pnpm 输出会去掉 ANSI / 进度噪声，只保留最后几行；失败时附上可手动重试的完整命令。

---

## 实现结构

```
lib/
  index.js      插件入口：注册 /plugin-update、补全树、bridge；启动时检查补丁状态
  command.js    update 流程：选择器、目标解析、结果格式化
  bundles.js    插件候选列表（pluginManager 优先，profile package.json 回退）
  update.js     dsh CLI 调用、参数构造、输出清理
  output.js     ANSI/进度清理与尾部截断
  patch.js      宿主补丁的 apply/remove/status（锚点校验、原子写入、状态文件）
  profile.js    profile / DSH_HOME / dsh-tui 路径解析
  bridge.js     宿主与插件之间的 Symbol bridge
  i18n.js       中文 / English
assets/
  icon.svg      插件标志（package.json 的 icon 字段，同时导出为 ./icon）
scripts/
  install.mjs   一键安装（add + patch）
  uninstall.mjs 还原补丁 + 移除插件
  patch.mjs     补丁 status/apply/remove
  verify-patch.mjs  在临时副本里验证补丁后的真实 ESM 模块
```

查看补丁状态：

```powershell
node scripts\patch.mjs status --profile dsh-tui
```

输出包含 `dshTuiVersion`、`supported`、`patched`、缺失的锚点和上次写入记录。

---

## 开发与验证

```powershell
cd D:\Project\ds-plugin-update
node --test                 # 45 个单元测试
node scripts\verify-patch.mjs --profile dsh-tui
```

`verify-patch` 会把当前 dsh-tui 的 `lib` + `tui-profile` 复制到临时 profile，链接好依赖，写入补丁，然后真实 import：

- `parsePluginArgs('update alpha')` → `{ kind: 'update', target: 'alpha' }`
- `pluginReport('update alpha', …)` → 命中 bridge
- 没有 bridge 时返回两行可读的“插件未启用”提示
- `/plugin ` 补全出现 `update`
- `/plugin update ` 补全出现 `all` 和插件名

---

## 常见问题

**`/plugin update` 提示未知子命令 / 没出现 `update`**
别名补丁没写或没生效。先 `/plugin-update patch`，再重启；或跑 `node scripts\patch.mjs apply --profile dsh-tui`。

**`/plugin update` 说需要 dsh-tui-plugin-update 插件**
补丁在，但插件没启用。运行 `/plugin list` 看看；用 `/plugin enable dsh-tui-plugin-update` 或重新安装。

**升级 dsh-tui 后失联**
同上，重新写补丁并重启。`/plugin-update` 始终可用。

**pnpm 找不到**
`dsh plugin` 需要 `pnpm` 在 PATH 中；也可以用 `DSH_BIN` 指向 dsh 可执行文件。

**想完全回到原样**
`node scripts\uninstall.mjs --profile dsh-tui`，或 `node scripts\patch.mjs remove --profile dsh-tui` 只还原宿主补丁。

---

## 兼容性

- dsh-tui **0.16.1 / 0.17.0**（锚点已验证；0.17.0 做了真实模块集成验证）
- Node.js `^22.19 || >=24`
- Windows / Linux / macOS 的 profile 启动路径；Windows 下通过 `cmd.exe` 调 `dsh`
- 不依赖任何 npm 运行时依赖，只有 Node 内置模块
