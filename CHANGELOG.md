# Changelog

## 0.4.0 (2026-09-05)

**安全立场切换：无感自治**——不追求极致安全；在"后台优先 + 升级链 + 恢复原前台 + 审计注记"底座上做到"易用无感、自动提权、极危敏感警告、仅作基本兜底"（规格见 PLAN-usability-first）。

### Removed

- **危险词审批网关**：`computer_*` 动作不再向用户征询（零打断）；`guard()` 不再依赖 approval 服务，插件 `inject` 移除 `approval`。密码框 `click` 由"审批"改为"放行 + 凭据注记"。
- **`permissionMode` 配置**（三档坍缩）：观测降级链（桌面级采集兜底 / `visualOnly` 标注 / `driverAccess` 权限面探测）**常开**，不再受模式开关控制。

### Changed

- **默认值翻转**：`deliveryMode` 默认 `auto`（原 `background`——后台不可用自动升级并恢复原前台）；快照 `ttlMs` 默认 `60000`（原 `30000`）。
- 极危注记层扩展位落为配置 `extremePatterns`（正则源数组，默认空 = 零差异），命中元素标签时在结果附加警告注记、不阻断。

### Security

- 凭据硬保护不变且为唯一硬拒绝：密码框（AXSecureTextField 等）`computer_type` 依旧直接拒绝自动输入。
- 兜底护栏不变：`allowedApps` 区域白名单、快照 TTL、无快照拒绝、engineRefusal 拦截、三级链恢复原前台、全量投递注记（归因审计）。

## 0.3.0 (2026-09-05)

基于上游 `07477f4` 的维护分支（Windows 深度实测）。

### Fixed

- `get_window_state`：AX 模式非降级路径返回 `image: null` 时触发宿主 schema 校验失败（`"value.image" must be an object`）——`image` 字段现仅在 native 模式输出。
- `resolveBin`：新增 cua-driver 官方安装器默认位置 `~/.cua-driver/packages/current/` 探测（此前无 PATH 环境直接 ENOENT）。
- `computer_type` / `computer_key`：引擎拒绝结构不再伪装成功（`ok: false` + 拒绝原因）。
- `diff`/观测类示例脚本：`New-Object System.Drawing.Bitmap($var)` 在 `-File` 模式下产生 String 伪装（假阳性断言）的根因说明与类型断言范例。

### Added

- **组合键 hotkey 通道**：`computer_key` 组合键改走 driver `hotkey`（目标感知派发）——XAML/WinUI/UWP 目标自动匹配 UIA `AcceleratorKey`（无焦点窃取、无需系统输入队列）；无修饰键维持 `press_key`（PostMessage 后台）。
- **`permissionMode`**（默认 `standard`）：`full-access` 观测失败自动降级桌面级采集（视觉仅读）+ AX 空树 `visualOnly` 标注 + `driverAccess` 驱动权限面探测；`unrestricted` 额外放行危险词审批（密码框保护与白名单不受影响）。
- **`deliveryMode`**（默认 `background`）：三级投递升级链——background → foreground（驱动自带激活+恢复）→ `bring_to_front`（AttachThreadInput 绕 Windows 前台锁）→ 重试 → 恢复原前台；工具级 `foreground: true` 单次覆盖。
- **`unverifiable` 回执注记**：引擎仅返回投递回执时显式标注「未验证目标响应」，不再伪装成功。

### Security

- 密码框保护、`allowedApps` 区域白名单、快照 TTL、无快照拒绝等护栏在所有模式下保持不变（`unrestricted` 仅放行危险词审批一项）。
