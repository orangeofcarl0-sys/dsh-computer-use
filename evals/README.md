# S4 评测回归（evals/）

插件级回归评测：确定性 setup/oracle 的桌面任务，经 harness 真实会话执行，PowerShell oracle 记分。
spec 见工作区 `PLAN-s4-eval-regression.md`（§3 两组结构、§6 AC、§8 拍板、§10 基线与分析）。

## 任务集（2026-09-09 基线后重排：只留重要×快；重要但慢的做优化）

**优化原则**：oracle 一律不改（判据不变才可跨版本比较），只把 setup **预置到决策点**——
应用已开、目录已停、内容已载。被测能力保留，启动/导航/发现的探索成本砍掉。
另加两层运行期加速：`--max-steps` 步数预算（快速失败）、推理档位对照（跑 Medium 档）。

### 冒烟组 smoke（日常回归必跑，目标单条 ≤5min）

| id | 任务 | 被测能力 | 预置 | 基线步数 |
|---|---|---|---|---|
| t01 | 记事本输入两行并保存 | type/key/save 闭环 | 空白记事本已开 | 25（试跑 pass） |
| t04 | 计算器 1234×5678 | 多步操作 + UIA 数值断言 | 计算器已开 | 73（pass） |
| t07 | 窗口最大化并保持 | 窗口控制 / perform_action | workfile 已开 | 14-18 |
| wa2 | 设文件为隐藏（WAA 0c9d… 本地化） | 资源管理器属性操作 | 资源管理器已停在目标并选中文件 | 73（timeout，导航导致） |

### 核心组 core（低频跑，重要但慢 → 已优化）

| id | 任务 | 被测能力 | 预置 | 基线步数 |
|---|---|---|---|---|
| t03 | 资源管理器重命名文件 | 就地文件操作 | 资源管理器已停在目标目录 | 59（timeout） |
| t05 | 另存为 + ANSI 编码 | **另存为对话框/编码下拉（最大缺口）** | 源文件已用记事本打开 | 50（timeout） |
| t06 | 剪贴板粘贴保存 | 剪贴板链路 | 剪贴板已置 + 空白记事本已开 | 57（timeout） |
| t09 | 画图填充纯红并保存 | 图形表面 + 像素级 oracle | 画图已开 | 57（timeout） |
| t10 | 两文档内容互换 | **多文档/多窗口状态管理（最大缺口）** | 两文件已载入记事本 | 48（timeout） |

### 退役（2026-09-09，git 历史可恢复）

| id | 退役理由 |
|---|---|
| t02 find-replace | 与 t01 同表面（记事本+保存），查找替换价值中低 |
| t08 run-dialog | 启动通道 oracle 不可判定，且与 t01 重复 |
| wa1 archive-docx | 与 t03 同表面（资源管理器文件操作），多文件操作非独立能力 |
| wa3 canvas-resize | 与 t09 重复（画布尺寸并入 t09） |
| wa4 paint-save | 与 t09 重复（仅存在性判定，信息量最低） |
| wa5 png-list | 与 t03/wa2 同表面（explorer 列举 + 写文件） |
| wa6 calc-days | 与 t04 同表面（计算器），日期模式导航属噪声 |

WAA 组由 6 条缩至 1 条（wa2）：基线显示两组同构失败（瓶颈在执行面而非任务措辞），
保留 wa2 作 WAA 溯源代表并转入冒烟组。原 6 条的共同问题是“表面与自编组重复 + 需深层路径导航”。

## 目录约定

```
evals/
  README.md            本文件（约定 + 溯源总表 + 弃选留档）
  run.mjs              运行器：逐任务 setup → harness 会话 → oracle → cleanup → 报告 JSON
  verify-oracles.mjs   oracle 独立验证（AC2）：setup→oracle 必须 fail；simulate→oracle 必须 pass
  lib/
    common.ps1         PS 共享前置：沙箱根、JSON 输出、路径约定（所有 PS1 dot-source）
    cdp.mjs            零依赖 CDP 客户端（Node 22 原生 WebSocket，驱动 headless Chrome）
  tasks/<id>.md        任务定义：prompt 原文 + 元数据（WAA 组含溯源头）
  setup/<id>.ps1       预置状态（幂等，先自清理）
  oracle/<id>.ps1      判定：exit 0=pass / 1=fail / 2=环境错误；stdout 一行 JSON
  cleanup/<id>.ps1     清理沙箱
  simulate/<id>.ps1    AC2 专用：不经 GUI 直造"任务成功态"，验证 oracle 会 pass
```

- `<id>`：自编组 `t01`…`t10`，WAA 本地化组 `wa1`…`wa6`（文件名主干即 id）。
- **PS1 一律 ASCII-only**（PowerShell 5.1 把无 BOM 脚本按 ANSI 解析，中文注释会炸解析器）——中文只进 .md。
- 沙箱根：`%USERPROFILE%\.dsh\s4-evals\<id>\`。任务涉及"Documents/Desktop/Pictures"的一律本地化为沙箱内对应子目录（防动用户真实文件），改动点记入任务 md 溯源说明。
- 判定原则（不可妥协）：oracle 绝不用模型自评，全部 PS/Win32 确定性读；setup/oracle 与被测动作解耦（runner 直调）。

## 环境知识（2026-09-08/09 实测，写脚本前先读）

- **Win11 记事本会恢复上一会话**：`%LOCALAPPDATA%\Packages\Microsoft.WindowsNotepad_*\LocalState\TabState\*.bin` 让未保存标签在下次启动时复活——基线里“幽灵 notepad 窗口”与 t07 级联失败的真机制。`hygiene.ps1 -ClearNotepadTabState` 可清（**会丢未保存文档，含用户自己的，故须显式开启**）；默认只关窗口+报告。
- **WinUI3 应用 `MainWindowHandle` 恒为 0**（计算器实证）：就绪判定用 UIA（`Test-CalculatorVisible`/`Start-Calculator`），别用 MainWindowHandle。
- **剪贴板可能被占用**：set 后立即 get 可能为空 → set+verify 重试（t06 setup 已实现）。
- **打包应用重启竞态**：杀进程后要等它真正消失再启动，并带重试（`Start-Calculator`）。
- **驱动提权窗口清理不掉**：cua-driver（疑似提权）spawn 的窗口，非提权侧 taskkill/Stop-Process/PostMessage 全失效（UIPI）；`Close-TaskWindows` 只能处理脚本自己启的窗口。这是当前最大的环境噪声源，修复项见 PLAN §10.5。
- notepad 标签页控件类型是 **TabItem**（不是 ListItem）；窗口标题只显示活动标签。
- **Win11 记事本上驱动的三条输入通道都可能不可达**（2026-09-16 受控窗口实测）：`hotkey` 走 UIA 加速器扫描 → 4s 超时（"a UIA provider in the target app is likely unresponsive"）；`press_key`（PostMessage）不报错但 `effect:unverifiable`、目标无反应；`invoke_menu` 返回 `menu_path_unavailable`（XAML 菜单驱动走不到）。→ 依赖 Ctrl+S 保存的任务（t01/t05/t06/t10）在该目标上会被驱动层挡住；可用替代是点击工具栏/菜单控件（element 编号点击），或换目标应用验证。插件已把 UIA 超时翻译成"改用点击控件"的可执行指引，并把驱动的 `refusal` 回执识别为失败（此前 menu 会把拒绝当成功上报）。
- **记事本进程会被复用**：`notepad.exe` 单进程多标签，自己起的实例可能被用户后续打开的文件占用 → 清理测试窗口要按**标题**匹配，不要按进程名杀（2026-09-16 实测：我的测试进程被用户文档复用）。
- **驱动提权链（2026-09-16 实测，上游 #3607 已附证据）**：`cua-driver.exe` 的二进制清单是 `requireAdministrator` → daemon 恒为 High IL → **`app_launch` 启动的应用继承 High IL**（对照：同一 shell 直接 `Start-Process notepad` 为 Medium IL）→ 非提权客户端 `taskkill`/`Stop-Process`/`WM_CLOSE` 全被拒（UIPI），残骸窗口累积并干扰后续任务观察（基线 t07 级联失败的元凶之一）。驱动**确实能**操作自己启动的 High IL 窗口（提权记事本上 `computer_type` 成功且 `effect:confirmed`），所以"管理员窗口不可操作"的旧说法不成立——真实边界是"客户端清不掉"。且 WinUI 目标上连驱动侧关闭通道也断（`alt+f4` 撞 #3908 的 UIA 超时、`invoke_menu` 报 menu_path_unavailable）→ 只能人工收尾。**评测实践：优先操作已在运行的普通应用；用 `app_launch` 的任务要接受人工收尾成本。**
- **dsh 0.1.5 UI 变化（2026-09-16 实证）**：`document.execCommand('insertText')` 在 composer 上失效（长度恒 0，会发出空消息）→ 必须走 CDP `Input.insertText`；轮次页脚由 `N 轮 · M 步` 变为 `N 轮 M 步`（无分隔点）；新建会话后页面可能被其他会话视图覆盖 → 发送前必须**二次校验当前会话仍是 0 轮**，回合结束再校验 prompt 标记在活动会话文本里。
- **「新建会话」点击可能不生效**（视图被钉在历史会话上；2026-09-16 实测：无弹层、无导航、harness 日志无报错，普通点击与 trusted CDP 点击都一样，而同一页面其它按钮点击正常）。**可靠恢复 = 重载客户端**——新加载会直接给出空会话（这也解释了为什么"重启/新开客户端"总能正常跑）。runner 已内置：点击无效 → 重载客户端 → 重试，最多 3 轮，并在日志打印 `session view pinned → reloading client`。

## 模型通道配置（opencode go 6649，2026-09-16）

ZCode 侧的廉价同源通道（同一 deepseek-v4.1-flash，走 opencode zen/go 代理）搬进 dsh 的三处改动，全部在 `~/.dsh/settings.yaml`（备份 `settings.yaml.bak-pre-opencode-go-*`）：

1. `agent-default-model` 改指 `opencode-go / deepseek-v4.1-flash / high`（新会话默认用它；旧值 deepseek-official/deepseek-flash）。
2. 补全 `llm-pi-ai.providers.opencode-go`（原本只有 apiKeyEnv 的半成品）：`api: openai-completions`、`baseURL: https://opencode.ai/zen/go/v1`、模型规格（1M 上下文 / 128K 输出 / 文+图）。
3. **必需请求头** `x-opencode-session: <uuid>`——该路由按会话做路由亲和，缺头会被 400 `MissingSessionID` 拒掉（"Request is missing x-opencode-session"）。dsh 的 provider 配置支持 `headers:` 字段（`dsh-llm-pi-ai` 会把 `profile.headers` 并入请求）。密钥无需搬运：`.credentials.yaml` 里已有 `OPENCODE_GO_API_KEY`。

诊断顺序（复现用）：探针号 `probe-model`（读选择器标签）→ `probe-menu2`（列出模型/推理档条目）→ `probe-compat`（最小回合：0 轮新会话 → 输入 → 发送 → 轮询回合是否出内容）。
runner 侧用 `--pin-model "DeepSeek V4.1 Flash (OpenCode)" --pin-effort High` 钉定，避免依赖会话记忆。

### 首次运行结果（2026-09-16，冒烟组，8 分钟 / 40 步上限）

| 任务 | 结果 | 步数/时长 |
|---|---|---|
| t07 窗口最大化 | **pass** | 7 步 / 104s（旧配置 18 步 / 301s） |
| t01 记事本输入保存 | timeout | 36 步 / 494s |
| t04 计算器 | timeout（撞步数上限） | 40 步 / 439s |
| wa2 设隐藏 | timeout | 32 步 / 494s |

步速约 11-15 秒/步；能收敛的任务很快（t07 一条动作 104 秒收工），不收敛的仍在多窗口/对话框上耗满预算——与旧配置同构，说明瓶颈在任务执行面而非模型档位。

## 运行期语义（试跑定案 2026-09-07）

- **prompt 统一前置约束**：仅图形界面完成 + 不向用户提问（runner 单点注入）。首次实跑发现：agent 会走文件写入工具直写沙箱（workspace-write 拒绝后**请求 danger-full-access 提权**，卡审批 15 分钟）——沙箱目录故意放在会话 workspace 之外，配合 runner 审批**自动拒绝**（>4 次拒绝记 error）把 agent 推回 GUI。
- **回合结束判定**：页脚"N 轮 · M 步"计数 + 消息流静默 12s + 无停止按钮。发送按钮 disabled≠回合信号（它只是"输入框为空"）。
- **超时**：默认 15 分钟/任务；打满预算判 timeout 且跳过 oracle（不进通过率分母）。
- **发前安全闸**：新会话必须 0 轮，否则拒绝注入（HARDOFF §4-7）。
- **回合在服务端继续**：runner 放弃后 agent 仍在跑——`maintain.mjs` 负责停"进行中"回合/拒绝审批；残留窗口由各 cleanup 的 `Close-TaskWindows` 收拾。
- **计时**：轮次=页脚"N 轮"（1 轮会话也显示；"跳转到第 N 轮"按钮只在多轮会话出现，取 max）；步数="M 步"=工具调用数。

## 运行

```
node evals/run.mjs --tasks t01,t04                    # 跑指定任务
node evals/run.mjs --group authored|waa|all           # 按组跑（缺省 all）
node evals/run.mjs --tier smoke                       # 只跑冒烟组（日常回归）
node evals/run.mjs --max-steps 40 --timeout-min 8     # 快速模式：步数预算 + 墙钟兜底
node evals/run.mjs --model-label dsv4fv-medium        # 档位对照（同样的集，换推理档）
node evals/verify-oracles.mjs                         # AC2：全部 oracle 双向独立验证
node evals/stop-stale.mjs "<url>" 18                  # 止损：停 >18min 的残留进行中回合
node evals/maintain.mjs "<url>"                       # 停残留 + 拒绝待审批
```

- `--dsh-url` 缺省调 `~/.dsh/restart-dsh-capture.ps1`（token 每次重启轮换，stdout 捕获至 `~/.dsh/web-latest.log`）。
- 浏览器：本机 Chrome headless（`--remote-debugging-port`，零 npm 依赖）。
- 报告：`dsv4fv-exp/s4-report-<date>.json`（真值产物不入库，AC5）；仓库只进 runner/任务/oracle。
- **快速模式建议**：冒烟组用 `--tier smoke --max-steps 40 --timeout-min 8`（4 条约 15-25 分钟）；
  核心组单独排期跑。

## 报告 schema

```json
{ "date", "model", "dshVersion", "pluginVersion",
  "tasks": [{ "id", "group": "authored|waa", "tier": "smoke|core", "waaId?", "sessionId",
               "verdict": "pass|fail|timeout|error", "steps", "wallMs", "oracleDetail" }],
  "passRate": { "authored", "waa", "all" } }
```

## WAA 本地化组溯源（source: microsoft/WindowsAgentArena, MIT）

选集原则：本机已有内置应用、判定可 PS 确定性化、无网络依赖、不改动用户真实系统配置。
判定只取原任务**意图**，实现一律重写为本仓库 PS oracle（原评测栈为 Python/pyautogui + 云端金标文件）。
2026-09-09 起本组仅保留 wa2（见上方退役表）。

| id | waaId | 原域 | 原 instruction 摘录 | 本地化改动 | 判定 |
|---|---|---|---|---|---|
| wa2 | e27984c7-968c-48d7-b2c3-6e45cdcc5249-WOS | file_explorer | Set the file "secret.txt" in the Documents folder as hidden. | Documents→沙箱目录；文件由 setup 本地生成；资源管理器预置停在目标并选中文件 | is_file_hidden 同义 PS 重写 |

| id | waaId | 原域 | 原 instruction 摘录 | 本地化改动 | 判定 |
|---|---|---|---|---|---|
| wa2 | e27984c7-968c-48d7-b2c3-6e45cdcc5249-WOS | file_explorer | Set the file "secret.txt" in the Documents folder as hidden. | Documents→沙箱目录；文件本地生成；资源管理器预置停在目标并选中文件 | is_file_hidden 同义 PS 重写 |

（其余 5 条 2026-09-09 退役，原定义见 git 历史；退役理由表在上方“退役”节。）

### 弃选留档（R6）

- **chrome/msedge 全部（30 条）**：网络与登录态依赖，判定不可本地确定性化。
- **clock（4）**：定时器/世界时钟无 PS 可读的持久判定面。
- **settings（5）**：判定可行（注册表）但任务本身**改动用户真实系统配置**（时区/通知/夜间模式/壁纸），违反沙箱原则。
- **vlc（21）/ vs_code（24）/ libreoffice（43）**：本机未装或版本不可控，setup 无法零网络预置。
- **file_explorer 其余**：zip 加密（b0c9dac6 依赖 7-zip）、共享权限（b12921b2 改真实 ACL）、回收站还原（f934d80d 状态不可预置）等，判定或预置不可确定性化。
- **notepad 两条**：366de66e 与自编 t01 语义重合（镜像退化，R6）；a7d4b6c5 依赖下载 largefile.txt，本地化后与 t02 重合。

## 许可

WAA 任务语义（instruction/判定意图）来自 microsoft/WindowsAgentArena（MIT License，见 Public/waa-upstream/LICENSE）；本地化条目按 MIT 附源链接与原 ID 溯源，不复制其代码与资产文件。
