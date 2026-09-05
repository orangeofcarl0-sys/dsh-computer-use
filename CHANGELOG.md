# Changelog

## 0.5.3 (2026-09-06)

**结构性密码检测（Windows）**——PLAN-credential-guard 第二期：凭据硬保护从启发式升级为读取系统真实属性（结构位），补齐"无标签 + 空值"密码框盲区。探针实证关键前提：经典 Win32 `ES_PASSWORD` 样式位在两种 UIA 客户端均映射 `IsPassword=false`，样式位才是系统真值（已作为 follow-up 反馈上游 [#3576](https://github.com/trycua/cua/issues/3576#issuecomment-5554919425)）。

### Added

- **UIA sidecar**（`tools/uia-password-scan.ps1` + `lib/passwordScan.js`）：`screen_observe` 时遍历目标窗口元素，密码 = `IsPassword`（现代框架 provider）∨ `ES_PASSWORD` 样式位（经典 Win32，`NativeWindowHandle` + `GetWindowLongW` 实测）→ 标记快照 entry → guard **结构位优先**硬拒。失败/超时（3s）自动降级启发式并在结果注记；误差方向安全（坐标错配只会漏标不会误标）。
- `tools/password-probe.ps1` 自包含探针（A6）：WinForms 密码框 + UIA 自扫 + Win32 样式真值三重交叉验证；出货版 sidecar 已对活体探针窗口端到端命中（无标签空值密码框，count=1）。

### Changed

- Config 新增 `passwordScan: 'auto' | 'off'`（默认 auto；off = 零 spawn，凭据保护退回启发式）。权限面新增 powershell 固定 argv spawn（随包脚本、只读、无网络），PERMISSIONS/summary/命令清单如实更新；承诺矩阵 Windows 凭据行升级为「结构位」。

## 0.5.2 (2026-09-06)

**Windows 凭据硬保护静默失效根治**（规格 PLAN-credential-guard；发现于 dsv4fv 定位实验真值交叉检查）。

### Fixed

- **凭据硬保护在 Windows 上静默失效**：cua-driver 元素投影按平台原生命名 role（Windows = UIA 原生 `Edit/Button/…`，无 AX 前缀）且无密码标志位，guard 匹配 macOS AX 命名（`AXSecureTextField`）在 Windows 上永假——密码框检测整体失效且无任何注记。
- 新增 `lib/roles.js` 跨平台角色语义层（单一出口）：密码**三态判定** `isPasswordCandidate`（结构化 AX 角色 ∪ Windows 启发式：文本输入类角色 × 密码词/掩码值，'显示密码'按钮等非输入类仅注记不硬拒）、`isActionableRole` 跨平台集合（**Windows 纯图标无标签按钮恢复编号**；AXSecureTextField 原遗漏补齐）。

### Changed

- 快照 entry 增加 `value` 字段（掩码判定数据源；`label` 不再合并 value）；`ROLE_SHORT` 补 Windows UIA 中文映射（Button→按钮 等）。

### Security

- PERMISSIONS.md 新增**「承诺验证矩阵」**（承诺 × 平台 × 验证载体 × 状态）——安全承诺自此按平台实测，杜绝"代码看起来对"式声明。
- 上游契约缺口已提回：[trycua/cua#3576](https://github.com/trycua/cua/issues/3576)（请求元素投影增加 `is_password`）；补齐前 Windows 保护以启发式运行，误报面与语义见 PLAN-credential-guard §5/§6。

## 0.5.1 (2026-09-06)

结构与复杂度优化（纯结构重构，**零行为变化**——19 工具注册面经 parity 脚本逐字段验证一致）。

### Changed

- **index.js `apply()` 384 → 44 行**：19 个工具注册拆为模块级三组工厂 `registerObserveTools` / `registerActionTools` / `registerOpsTools`（apply 只剩配置装配 + 会话初始化 + wrap + 三次调用）。
- **observe.js `screenObserve` 188 → 117 行**：抽出 `missingTreeFallback`（补抓判定）、`cacheSnapshot`（快照缓存）、`resolveObserveMode`（native/vision/ax 模式决策与降级链）三个纯函数。
- **图片持久化收敛**：新增 `lib/attach.js saveImageAttachment` 统一出口，5 处 `attachments.saveImage` + 输出块装配调用点归一（尺寸回退语义逐点保留）。

### Security

- **权限面修正**：`vision.js loadKey` 移除家目录密钥文件扫描（`~/.zhipu-key` 等，上游继承的死代码），仅保留 `ZHIPU_API_KEY` / `GLM_API_KEY` 环境变量；PERMISSIONS.md / package.json / docs/store-evidence.md 如实声明（凭据信号从"未命中"改为"轻微命中（可选）"）。

## 0.5.0 (2026-09-06)

工具改进包（规格 PLAN-tools-v0.5，拍板：D1 独立工具 / D2 锁存+resume / D3 hover 入包）。12 → **19 工具**。

### Added

- **`computer_verify`**：确定性验证——driver `verify_state` 包装，1-8 条结构化谓词（element: role/label_contains × exists/enabled/selected/value_equals；window: exists/bounds±tolerance）AND 求值；satisfied / unsatisfied / **unknown**（unknown 永不视为成功，fail-closed）；可选截图证据。
- **`computer_wait_for`**：谓词轮询等待，满足即返回（含等待时长/次数），超时结构化失败（不伪装成功）——替代盲等。
- **`computer_clipboard`**：剪贴板读写；`write` + `ctrl+v` 组成可靠"粘贴流"。
- **`computer_menu`**：菜单路径直调（driver `invoke_menu`，fail-closed，绝不回退像素）。
- **`computer_hover`**（实验性）：移动虚拟光标；`real=true` 移动真实 OS 指针（scope=desktop）。真实 hover 效果取决于应用，未验证。
- **`computer_stop` / `computer_resume`**：强杀开关——stop 结束驱动会话 + 清观察快照 + **锁存全部桌面操作**（观察/动作/应用一律拒绝）；resume 唯一解锁路径并预热会话。S3 的确定性半边就此补齐。

### Security

- 锁存闸门位于守卫之前（锁存优先级最高）；stop/resume 均带审计注记；凭据硬保护与极危注记不受影响。

## 0.4.1 (2026-09-05)

依据 dsv4fv 像素定位实验（SURVEY 附录A：整窗裸定位 median>300px、先验驱动的布局重建、目标主导小裁剪 13-80px）落地 S2 修订。

### Added

- **`screen_zoom` 定位原语**：结果新增结构化 `crop` 元数据（原点 x/y、尺寸 w/h、换算比例 scale），结果文本给出换算公式（图内坐标 × scale + crop.x/y = 整窗截图像素）——支撑树空/像素目标的"裁剪 → 语义确认 → 换算 → 点击"定位环。

### Changed

- `screen_zoom` 工具描述改写为双用法（放大细看 / 定位环），并写明"整窗裸定位不可依赖、裁剪务必让目标占画面主导"的实验结论。

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
