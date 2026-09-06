# ROADMAP — dsh-computer-use

个人项目路线图。状态基线：**v0.4.1**（无感自治姿态 + screen_zoom 定位原语，已发布）。

## A. 事实澄清排期（冻结，不主动执行；按触发条件解冻）

| # | 事项 | 触发条件 |
|---|---|---|
| A1 | dsh 真实通道复测 dsv4fv native/vision（attachments+ctx.llm 管线 vs 裸 API 下界） | ✅ 2026-09-06 会话实测（模型 DeepSeek-V4-Flash-Vision-Exp/High）：ax ✓（注记/guard 全对）、native ✓（图片块经宿主 attachments 管线到模型，准确描述布局；首 token 0.9s/116 tok/s/缓存 74%）、vision 管线 ✓ 但**观察者半通**——dsv4fv 作观察者只输出思考不返回文本，GLM 兜底因未配 ZHIPU_API_KEY 优雅降级提示（不崩溃）；后续：配 key 启用兜底或换观察者模型 |
| A2 | GLM agent 通道跨 run 漂移 + SoM 标号绑定复测（若可行，S2 SoM 复活） | 需要像素路径升级为常规路径时 |
| A3 | qwen3-vl 坐标帧错位根因（代理缩图 vs 模型）+ glm-5.3-flash 代理 API 基线 | 本地代理账号池稳定时 |
| A4 | 运行时真实验证：用户层覆盖退役生效 / driverAccess / L3 恢复断言 / crop 换算端到端 | 同 A1 |
| A5 | dsv4fv OCR 数字噪声量化（S3 断言容差输入） | 与 S3 设计时一并 |
| A6 | Windows 密码框投影探针（WinForms PasswordBox → screen_observe 形态实测）+ 凭据启发式命中验证 + move_cursor 坐标系顺带确认 | ✅ 2026-09-06 运行时 E2E（真实驱动+探针 9/9）：结构密码标记注记 ✓、guard 结构位硬拒 ✓、普通框零误拒 ✓、sidecar 时延 1.4-1.6s（阈值 5s）✓、zoom crop 元数据 ✓。**发现并修复标记坐标系错误**（frame=屏幕px 直配，见 CHANGELOG 0.5.3 Fixed）；move_cursor window-scope 实测返回 unverifiable/non_applicable（较"硬拒 invalid_action_target"记档已变化）；驱动对空值经典 Edit 返回伪 value 数字（显示噪声，启发式不受影响）；截图为窗口裁剪（606x287）而 frame 为屏幕 px |
| A7 | **坐标语义落点实验**：observe 元素 frame=屏幕 px（实证），截图=窗口裁剪，header 标注"窗口本地截图像素"与 zoom 换算公式（无 +窗口原点项）疑似与坐标点击语义矛盾——0.4.1 实测 zoom 定位误差 13-80px 恰为窗口原点量级 | ✅ 2026-09-06 六轮实验（v1-v6，dsv4fv-exp/a7-*）：驱动 0.23.2 文档契约 click x/y=窗口本地 PNG px、desktop 作用域=屏幕绝对（describe click 原文），但**实测行为与 screen/bounds-local/client-local 三种语义假设均有矛盾反例**（WinForms 事件坐标 DPI 混合致探针读数不可信、遮挡窗口干扰、foreground 前台恢复竞态遮蔽焦点判定）——驱动坐标换算疑似缺陷，插件层不可判定。已证可靠：element 模式（token 路径）；像素路径定性 best-effort（unverifiable 注记引导复观察已覆盖）。上游 issue 素材已备 |

## B. 0.5.0 工具改进包（✅ 已发布 2026-09-06）

规格见工作区 `PLAN-tools-v0.5.md`（拍板：D1 独立工具 / D2 锁存+resume / D3 hover 入包）。已落地：`computer_verify`（driver verify_state 包装，确定性谓词验证，unknown 永不视为成功）、`computer_wait_for`（谓词轮询）、`computer_clipboard`（读写）、`computer_menu`（invoke_menu 菜单路径直调）、`computer_stop`（强杀锁存）+ `computer_resume`（唯一解锁）、`computer_hover`（实验性，real=true 可移动真实指针）。12 → 19 工具；测试 tools.smoke 15 断言全绿。

## C. 驱动原生库存（已确认 0.23.2 存在、插件未暴露；候补池，不入 0.5.0）

- `browser_*` 全家桶（navigate/click/type/hover/set_input_files/dialog/download，CDP）——浏览器域动作面
- `set_window_frame`（窗口移动/缩放 + 读回验证）
- `get_accessibility_tree`（桌面级轻量快照：进程+窗口+bounds）
- `start/stop/replay_trajectory`（轨迹录制与重放）
- `kill_app`（强杀进程——若暴露需入极危注记清单）

## D. 驱动级缺口（插件无法包装，需上游）

- **坐标像素点击落点缺陷（0.23.2，A7 六轮实验）**：文档契约（click x/y = window-local PNG px）与实测行为矛盾——三种语义假设（screen/bounds-local/client-local）均有反例，落点疑似 DPI 混合换算（logical/physical 不一致）；foreground 恢复竞态使焦点类判定不可测。影响：zoom 定位环（像素路径）系统性误差（0.4.1 实测 13-80px 与原点向量同量级）。缓解：element 模式（token）为可靠主路径；像素动作依赖 unverifiable 注记 + 复观察。实验数据：`dsv4fv-exp/a7-*`
- middle_click / triple_click / mouse_down-up（长按、精细拖拽分解）
- 多显示器枚举与切换（get_screen_size 仅主屏）
- 真实指针 hover（move_cursor 仅移动 agent 覆盖层光标，hover 语义待验证）

## E. 远期

- 隔离档（permissionMode 已删，若需要走一次性会话/VM 路线）
- O1 UIAccess worker（重开条件：trycua 合规安装器 / 证书可离线验证 / 策略确认）
- 评测回归任务集（S4：10-20 条 WAA 式 PowerShell oracle 任务）
- S3 模型侧验证器（dsv4fv 读图断言 + OCR 噪声容差）——在确定性 verify_state 之外按需叠加
