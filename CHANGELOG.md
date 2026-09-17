# Changelog

## 0.5.5 (2026-09-17)

**动态工具面**（PLAN-meta-tool，拍板 2026-09-17）：诉求不是省 token，而是**避免 20 个工具的 schema 常驻造成的注意力负担**。

### Added

- **两态工具面**：折叠态（默认）只暴露 `computer_do` + 精简版 `screen_observe`；`computer_do({action:'enter'})` 后把另外 19 个工具**注册进该会话自己的 agent 作用域**，`exit` 或"连续 2 次非桌面工具调用"自动收起。工具面重量 **18846 → 3532 字符（−81%）**；展开态的 19 个工具与 v0.5.4 完全一致（细粒度 schema、宿主严格输出校验、未知参数拒发、工具级 guard 全部保留）。机制依据与真机取证见 PLAN-meta-tool §6.2：注册表**按请求**投影，所以展开/回落都在下一请求生效（探针逐步实测：折叠→不可调用、enter→下一请求可调用、exit→unknown tool）。
- `lib/surface.js`（两态状态机 + 作用域注册/dispose + 幂等 + 清单常量）、`tests/surface.mjs`（23 断言：折叠/展开/回落/幂等/作用域隔离/能力兜底/自动回落/清单一致性/注意力预算/锁存/事件接线）。
- `screen_observe` 描述精简化（534→322 字符，参数说明 510→405）：折叠态常驻工具必须轻；**输出 schema 不动**（宿主严格校验要求实现返回的字段都已声明，砍 schema 就得砍返回值）。

### Fixed

- **注册时丢失 schema 投影（加载失败级回归）**：P1-7 结构重构把 `defineTool()` 的返回值丢了，注册的是未投影的原始字面量 → dsh 0.1.5-rc.2 的 `assertSupportedJsonSchema` 拒绝（属性级 `required:true` 不在强制子集里）→ **整棵插件树加载失败**。离线假注册表不做该校验，171 断言全绿也漏掉了；真机探针一次命中。已修，并记入 HANDOFF 硬知识。
- **误订阅 waterfall 事件导致所有工具调用失败**：非桌面活动兜底最初挂 `tools/post-execute`（cordis waterfall，末位参数是 `next`），监听器不调 `next` 返回 undefined → 注册表读 `decision.kind` 崩溃 → 每次调用都报 `Cannot read properties of undefined (reading 'kind')`（探针 6/6 步同一报错）。改用仅观测事件 `tools/result`，并在测试里禁止再订阅 waterfall 事件。

## 0.5.4 (2026-09-17)

**主题**：dsh 0.1.5 大版本适配、点击坐标契约根治（所见即所点）、观察降噪与上下文预算 A–F、S4 评测回归系统、测试与代码结构治理。

### Added

- **observe 降噪**（工作区 PLAN-observe-noise，拍板 2026-09-16）：同一窗口 + 同一模式，且**上次观察后无任何动作**（快照未被消费）时，重复观察回极简回执——`observeDedup: summary`（默认，含"编号:角色"摘要）/ `brief`（单行）/ `off`（每次全量）；新增 `screen_observe(force=true)` 强制全量。判定用严格哈希并忽略时间/行列类噪声（实测：真实 35 元素记事本树 1586→250 字符，**降幅 84%**；brief 单行 95%）。注意本项省的是**上下文 token**，不减少工具调用步数（步速另由提示层"同一快照内无需重复观察"引导）。`maxElements` 默认 500→120（实测常见任务 30-70 个元素）。新增专项测试 `tests/observe.dedup.mjs`（13 断言：AC1 降幅 / AC2 变化必全量 / AC3 force / AC4 动作后必全量 / AC5 off 与 brief / D2 时间噪声）。

- **上下文预算 A–F**（工作区 PLAN-context-budget，拍板 2026-09-16）：A 观察/缩放描述写入成本阶梯（ax < zoom ~200 tok < native ~3K tok）与用途对应；B schema 瘦身 **10176→9486 字符**；C 新增紧凑动作回执 + `verboseReceipts`（正常路径 click 299→~90 字符，不可验证路径仍附明细）；D 树标签 100→48 字符 + 多行折首行；E `app_list` 紧凑化 491→418 字符；F **新增第 20 个工具 `computer_task`**——把一段桌面操作委派给一次性子 agent（`ctx.subagents` + `toolFilter` 限定 19 个桌面工具 + `outputSchema` 强制 {ok,summary,evidence} + `maxDepth=1` + 超时），主上下文只吃一条 ≤400 字符回执，宿主无该能力时回委派配方。新增 `tests/task.tool.mjs`（14 断言）并入 npm test（全库 101 断言）

- **坐标换算基准元数据**：observe/zoom 输出 `screenOrigin`（= `list_windows` 的 bounds；实测截图与该 bounds 逐像素相同）+ `coordinateSpace`，使"图内像素 × crop.scale + crop 原点 + screenOrigin = 屏幕物理像素"可算（zoom 实测为恒定 1.2× 上采样，裁剪宽 ≤500px）。
- **未知参数拒发**：宿主参数表编译后不含 additionalProperties，参数名写错会被静默忽略并可能回退"z 序最前窗口"（实测踩坑：给 screen_observe 传 `app=` 观察到了别的应用）→ `wrap()` 单点拒绝并列明可接受参数；observe 未指定 window 时结果显式注明"已取最前窗口"。
- **测试面**：`tests/schema.conformance.mjs`（把实现可能返回的每种形态——正常/守卫拒绝/观测降级/驱动错误——对着声明 schema 严格校验；本版收尾时覆盖 20 工具 × 42 场景）、`tests/live-action.e2e.mjs`（真桌面动作闭环 + 稳定性循环）、`tests/syntax.check.mjs`（修 `npm run check` 的 Windows glob 失效）。
- **S4 评测回归系统**（仓库 `evals/`）：9 条任务（冒烟 4 + 核心 5）、PS oracle 四件套（setup/oracle/cleanup/simulate）、AC2 双向独立验证、零依赖 CDP runner（`--tier/--max-steps/--pin-model/--pin-effort`）、maintain/stop-stale/hygiene 运维脚本；坐标标定与键盘通道诊断脚本一并入库。

### Fixed

- **结构化拒绝被当成功上报（同类缺陷第三、四处）**：`scroll`/`drag` 此前未识别驱动的 `{refusal:{code}}` 回执，把拒绝当成功上报——与 menu 同一坑。新增 `lib/receipt.js` 把"判拒绝 → 标快照消费 → 出回执"收成唯一出口，新增工具只要走它就不会再漏（`tests/schema.conformance.mjs` 的拒绝形态场景矩阵即是该类的回归网）。
- **坐标契约不一致导致点击整体偏移（根因修复）**：可控探针逐点标定（最小二乘残差 ≤0.55px）测出 `computer_click(x,y)` 的空间是**窗口矩形相对物理像素**（= 窗口截图空间），而 `screen_observe` 元素坐标是**屏幕物理像素**——两者差一个窗口原点向量（本机可达 1906×1166），模型"看到坐标直接点"必然打偏。观察输出已换算到点击空间（截图/元素/点击三者统一），文案与 `coordinateSpace` 同步更正；密码扫描/标记仍用原始屏幕坐标。
- **dsh 0.1.5 严格输出校验下观察工具整次失败**：观测降级回执（`window/elementCount/mode/elements/visualOnly/driverAccess`）未在 output schema 声明 → `screen_zoom`/`screen_observe` 的降级路径报 invalid output（工具等于不可用）。抽出 `DESKTOP_FALLBACK_FIELDS` 供两者共用。
- **驱动结构化拒绝被当成功上报**：`{"refusal":{code,message}}` 回执此前未识别 → `computer_menu` 对 `menu_path_unavailable` 仍回"已调用菜单路径"，模型据此继续下一步。抽出 `lib/engine.js` 统一识别四种拒绝形态（refusal/effect/error/code）。
- **zoom 的脆弱点与比例错误**：zoom 曾为取窗口尺寸做带 UIA 扫描的 `get_window_state`（WinUI 应用 4s 超时会把整次 zoom 拖进桌面降级）→ 改用 `list_windows` 的 bounds（实测其与截图逐像素相同）；scale 曾用 attachments 归一化后的尺寸（会算出错误比例）→ 改用驱动返回的图尺寸，并输出非等比缩放提示。
- **hotkey 的 UIA 加速器超时**不再抛原始引擎错误，改为可执行指引（改用控件点击/稍后重试）——上游 [trycua/cua#3908](https://github.com/trycua/cua/issues/3908)。
- verify-runtime 三处测试脆弱点：Windows 动态 import 需 `file://` URL、驱动自身窗口排除用了不存在的进程名（实际是 `cua-driver.exe`）、工具数断言写死 12-13（现改为下限 + 关键工具在册）。

### Changed（结构治理 P0/P1，2026-09-17）

代码屎山审计后的落地，全部以机械证据收口（parity 逐字节比对或测试断言），不含行为猜测。

- **测试脚手架去重（P0-1）**：新增 `tests/lib/harness.mjs`（临时工作副本 / 可编程驱动桩 / 假 ctx·exec / 与 dsh 严格语义对齐的 schema 校验器 / 断言记录器），`schema.conformance`、`observe.dedup`、`task.tool` 三套测试改为引用，删掉各自复制的 ~90 行脚手架。
- **schema 覆盖 13/20 → 20/20 工具（P0-3）**：22 → 42 场景，补齐 `computer_double_click`/`right_click`/`wait_for`/`hover`/`stop`/`resume`/`computer_task`（后者含结构化成功 / 无结构化 / 宿主无服务三形态），并按驱动真实形态补全"结构化拒绝"（`{refusal:{code}}`）场景矩阵——该矩阵直接暴露并修掉了 Fixed 节里那条 scroll/drag 缺陷。
- **配置接线测试（P0-2）**：新增 `tests/config.plumbing.mjs`——schema 键 ↔ `apply()` 组装的 cfg ↔ 实际读取点三向比对（含 `extremePatterns→extremeRes` 重命名白名单），外加 11 组行为哨兵（maxElements/observeDedup/verboseReceipts/supersession/ttlMs/deliveryMode/allowedApps/extremePatterns/cursorTheme/maxTaskCalls/visionProvider+nativeImage）；观测成本过高的 `passwordScan`/`taskTimeoutMin` 显式登记为静态兜底，不假装测过。
- **删死代码（P0-4）**：`dedupInvalidate`（降噪失效已由"快照消费"闸门覆盖）、`taskCallCount`、`runAction`（被 humanAction 取代后无人调用）。
- **拆超大函数（P1-5）**：`screenObserve`（194 行）→ 目标选择 / 抓树（含补抓与桌面降级短路）/ 结构性密码标记 / 元素映射 / 文本渲染 / 结果封装六个阶段函数；`screenZoom`（106 行）→ 目标解析 / 裁剪钳制 / 整窗回退。单函数 ≤66 行。**29 场景受控桩 parity 逐字节一致**。
- **回执统一（P1-6）**：新增 `lib/receipt.js`（`receipt` / `refusalReceipt` / `settleAction`），点击/双击/右键/输入/按键/滚动/拖拽/菜单全部走同一出口——`scroll`/`drag` 从 JSON 内联改为紧凑回执（与 click 同形），"引擎拒绝"判断从 6 处收敛到 1 处（该类缺陷已在 menu/scroll/drag 三处实际发生过）。
- **注册结构数据化（P1-7）**：四组工具改为返回定义数组的纯数据函数，注册与参数名登记收敛到 `apply()` 单处循环。**20 个工具的工具面 JSON 快照（描述/参数表/输出 schema/render/execute arity）逐字节一致**。如实说明：工具描述与 schema 是内容而非样板，`index.js` 体积基本未变（726→738 行），本项收益是"新增工具 = 加一项数据" + 工具面可机械校验。
- **测试量**：`npm test` 148 断言（原 103）；真桌面闭环 `tests/live-action.e2e.mjs` 3 轮 30/30。


## 0.5.3 (2026-09-06)

**结构性密码检测（Windows）**——PLAN-credential-guard 第二期：凭据硬保护从启发式升级为读取系统真实属性（结构位），补齐"无标签 + 空值"密码框盲区。探针实证关键前提：经典 Win32 `ES_PASSWORD` 样式位在两种 UIA 客户端均映射 `IsPassword=false`，样式位才是系统真值（已作为 follow-up 反馈上游 [#3576](https://github.com/trycua/cua/issues/3576#issuecomment-5554919425)）。

### Added

- **快照新鲜度语义**（PLAN-snapshot-freshness Phase A；REVERSE 逆向三点合流）：失效原因三分类 `[snapshot_expired]`（带快照 id）/`[snapshot_mismatch]`/`[snapshot_consumed]`；`supersession` 配置 off/note/enforce（默认 note：同快照连击附一致性注记不阻断）；动作工具新增可选 `snapshot_id` 显式证据基线参数（7 个 mutate 工具 + observe 输出 schema 增 snapshotId）；unverifiable 动作触发状态可疑注记（干预 P0 降级版，只注记不阻断）。上游需求已提：trycua/cua #3586（树版本+条件请求）、#3587（干预信号）。
- **S3a 视觉断言协议**（PLAN-s3-model-verifier）：A5 实证（可读 PNG 证据上 dsv4fv 数字转述噪声≈0、zoom JPEG 对小字号不可读、模型证据不足时 2/2 诚实拒答、同会话历史回声风险）落为工具描述协议——数字断言逐字双向校验不做编辑距离放宽、文字模糊子串+同义对照、只认本轮新鲜证据、不可读=unknown 不得编造；注入 `screen_observe`/`screen_zoom`/`computer_verify` 描述。零新工具零新权限；S3b（screen_assert 工具/独立观察者裁决）待观察者条件成熟。
- **UIA sidecar**（`tools/uia-password-scan.ps1` + `lib/passwordScan.js`）：`screen_observe` 时遍历目标窗口元素，密码 = `IsPassword`（现代框架 provider）∨ `ES_PASSWORD` 样式位（经典 Win32，`NativeWindowHandle` + `GetWindowLongW` 实测）→ 标记快照 entry → guard **结构位优先**硬拒。失败/超时（3s）自动降级启发式并在结果注记；误差方向安全（坐标错配只会漏标不会误标）。
- `tools/password-probe.ps1` 自包含探针（A6）：WinForms 密码框 + UIA 自扫 + Win32 样式真值三重交叉验证；出货版 sidecar 已对活体探针窗口端到端命中（无标签空值密码框，count=1）。

### Changed

- Config 新增 `passwordScan: 'auto' | 'off'`（默认 auto；off = 零 spawn，凭据保护退回启发式）。权限面新增 powershell 固定 argv spawn（随包脚本、只读、无网络），PERMISSIONS/summary/命令清单如实更新；承诺矩阵 Windows 凭据行升级为「结构位」。

### Fixed

- **结构密码标记坐标系错误**（A6 运行时端到端发现，2026-09-06）：`markElementsFromScan` 按"元素中心=窗口本地 + 原点换算"旧假设设计，而 cua-driver 0.23.2 的 frame 与 sidecar rect 同为**屏幕锚定物理像素**（同一密码框两套独立系统读数逐像素相等，探针 E2E 实证）——原点换算使标记整体偏移一个窗口原点向量，实测**标错相邻元素**（真密码框漏标 → guard 放行；上方普通框误标 → 误拒）。改为屏幕坐标直配，废弃双原点候选。sidecar 由 node 派生继承 DPI 感知返回物理 px（bash 直跑探针得逻辑 px，仅影响独立实验，部署路径一致）。E2E 9/9：注记/guard 硬拒/零误拒/sidecar 时延 1.4-1.6s/crop 元数据全通过。

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
