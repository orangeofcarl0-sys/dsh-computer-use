# ROADMAP — dsh-computer-use

个人项目路线图。状态基线：**v0.4.1**（无感自治姿态 + screen_zoom 定位原语，已发布）。

## A. 事实澄清排期（冻结，不主动执行；按触发条件解冻）

| # | 事项 | 触发条件 |
|---|---|---|
| A1 | dsh 真实通道复测 dsv4fv native/vision（attachments+ctx.llm 管线 vs 裸 API 下界） | 下次 harness 重启后的日常使用顺带做 |
| A2 | GLM agent 通道跨 run 漂移 + SoM 标号绑定复测（若可行，S2 SoM 复活） | 需要像素路径升级为常规路径时 |
| A3 | qwen3-vl 坐标帧错位根因（代理缩图 vs 模型）+ glm-5.3-flash 代理 API 基线 | 本地代理账号池稳定时 |
| A4 | 运行时真实验证：用户层覆盖退役生效 / driverAccess / L3 恢复断言 / crop 换算端到端 | 同 A1 |
| A5 | dsv4fv OCR 数字噪声量化（S3 断言容差输入） | 与 S3 设计时一并 |
| A6 | Windows 密码框投影探针（WinForms PasswordBox → screen_observe 形态实测）+ 凭据启发式命中验证 + move_cursor 坐标系顺带确认 | 下次 harness 重启后的日常使用顺带做；0.5.2 已先以离线启发式修复（PLAN-credential-guard） |

## B. 0.5.0 工具改进包（✅ 已发布 2026-09-06）

规格见工作区 `PLAN-tools-v0.5.md`（拍板：D1 独立工具 / D2 锁存+resume / D3 hover 入包）。已落地：`computer_verify`（driver verify_state 包装，确定性谓词验证，unknown 永不视为成功）、`computer_wait_for`（谓词轮询）、`computer_clipboard`（读写）、`computer_menu`（invoke_menu 菜单路径直调）、`computer_stop`（强杀锁存）+ `computer_resume`（唯一解锁）、`computer_hover`（实验性，real=true 可移动真实指针）。12 → 19 工具；测试 tools.smoke 15 断言全绿。

## C. 驱动原生库存（已确认 0.23.2 存在、插件未暴露；候补池，不入 0.5.0）

- `browser_*` 全家桶（navigate/click/type/hover/set_input_files/dialog/download，CDP）——浏览器域动作面
- `set_window_frame`（窗口移动/缩放 + 读回验证）
- `get_accessibility_tree`（桌面级轻量快照：进程+窗口+bounds）
- `start/stop/replay_trajectory`（轨迹录制与重放）
- `kill_app`（强杀进程——若暴露需入极危注记清单）

## D. 驱动级缺口（插件无法包装，需上游）

- middle_click / triple_click / mouse_down-up（长按、精细拖拽分解）
- 多显示器枚举与切换（get_screen_size 仅主屏）
- 真实指针 hover（move_cursor 仅移动 agent 覆盖层光标，hover 语义待验证）

## E. 远期

- 隔离档（permissionMode 已删，若需要走一次性会话/VM 路线）
- O1 UIAccess worker（重开条件：trycua 合规安装器 / 证书可离线验证 / 策略确认）
- 评测回归任务集（S4：10-20 条 WAA 式 PowerShell oracle 任务）
- S3 模型侧验证器（dsv4fv 读图断言 + OCR 噪声容差）——在确定性 verify_state 之外按需叠加
