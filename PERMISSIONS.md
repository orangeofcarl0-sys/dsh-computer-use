# PERMISSIONS — dsh-computer-use

本文件声明 `dsh-computer-use` 插件在运行时实际使用的权限面（DSH STORE 审查依据）。

## 总览（运行时行为）

- 通过**宿主 `child_process.spawn` 以非 shell 固定 argv** 调用 `cua-driver` 原生驱动（跨平台：macOS / Windows / Linux），驱动本地桌面：
  - 屏幕观测：`screen_observe` / `screen_zoom`（读取被观测应用的 Accessibility/AX 树与窗口快照）
  - 虚拟鼠标键盘模拟：`computer_click` / `computer_double_click` / `computer_right_click` / `computer_type` / `computer_key` / `computer_scroll` / `computer_drag` / `computer_wait`
  - 应用枚举与启动：`app_list` / `app_launch`
- `cua-driver` 可执行文件来源：环境变量 `CUA_DRIVER_BIN` 显式指定，或 `PATH` 查找；缺失时返回结构化错误（含自救指引），不静默。
- 内置安全护栏（所有工具统一走 `guard()` 包装）：**危险词审批**（敏感目标操作先请求用户确认）、**密码框保护**（检测到密码输入目标时拒绝）、**过期状态拒绝**（观测快照过期后拒绝执行）、**作用域权限**（仅授权应用/窗口内操作）。

## 明确不做

- ❌ 不读取任何用户文件 / 项目文件（无 `fs` 读写）
- ❌ 不发起任何网络请求（无 fetch / http / WebSocket）
- ❌ 不访问凭据 / 环境变量中的敏感信息（仅读取 `CUA_DRIVER_BIN` 定位可执行文件）
- ❌ 不在宿主写入任何文件
- ❌ 无 npm 生命周期脚本（install / postinstall 等一律没有；安装包内的 `install.sh` / `uninstall.sh` 是给用户手动执行的安装辅助脚本，非 npm lifecycle）
- ❌ 不触碰真实鼠标键盘焦点（独立虚拟光标，隔离运行，不抢占用户输入）

## 依赖（仅两个，均为官方/DSH 生态）

| 依赖 | 用途 |
|---|---|
| `@deepseek-ai/dsh-tools` | 注册 dsh 原生工具（`ctx.tools.register(defineTool(...))`） |
| `@deepseek-ai/schemastery` | 工具参数 schema 定义 |

## 权限信号对照（STORE 五信号）

| 信号 | 状态 | 说明 |
|---|---|---|
| 文件权限 | ⚠️ 命中 | `spawn` 子进程（cua-driver）是核心能力，属真实插件必备，提交人工审查 |
| 命令权限 | ⚠️ 命中 | `spawn` 仅限固定 argv 调用 `cua-driver`，非 shell（`shell: false`），无 `exec` / `eval` |
| 网络权限 | ✅ 未命中 | 无任何网络调用 |
| 凭据权限 | ✅ 未命中 | 不触碰 `process.env` 中的密钥/凭证（仅 `CUA_DRIVER_BIN`） |
| 生命周期脚本 | ✅ 无 | npm 元数据中无 install/postinstall/prepare |

完整安装/启动/卸载证据见 `docs/store-evidence.md`。