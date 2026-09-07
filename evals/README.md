# S4 评测回归（evals/）

插件级回归评测：确定性 setup/oracle 的桌面任务，经 harness 真实会话执行，PowerShell oracle 记分。
spec 见工作区 `PLAN-s4-eval-regression.md`（§3 两组结构、§6 AC、§8 拍板）。

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

## 运行

```
node evals/run.mjs --tasks t01,t02            # 跑指定任务
node evals/run.mjs --group authored|waa|all   # 按组跑（缺省 all）
node evals/run.mjs --model-label dsv4fv --dsh-url "<tokened URL>"
node evals/verify-oracles.mjs                 # AC2：16 条 oracle 双向验证
```

- `--dsh-url` 缺省调 `~/.dsh/restart-dsh-capture.ps1`（token 每次重启轮换，stdout 捕获至 `~/.dsh/web-latest.log`）。
- 浏览器：本机 Chrome headless（`--remote-debugging-port`，零 npm 依赖）。
- 报告：`dsv4fv-exp/s4-report-<date>.json`（真值产物不入库，AC5）；仓库只进 runner/任务/oracle。

## 报告 schema

```json
{ "date", "model", "dshVersion", "pluginVersion",
  "tasks": [{ "id", "group": "authored|waa", "waaId?", "sessionId",
               "verdict": "pass|fail|timeout|error", "steps", "wallMs", "oracleDetail" }],
  "passRate": { "authored", "waa", "all" } }
```

## WAA 本地化组溯源（source: microsoft/WindowsAgentArena, MIT）

选集原则：本机已有内置应用、判定可 PS 确定性化、无网络依赖、不改动用户真实系统配置。
判定只取原任务**意图**，实现一律重写为本仓库 PS oracle（原评测栈为 Python/pyautogui + 云端金标文件）。

| id | waaId | 原域 | 原 instruction 摘录 | 本地化改动 | 判定 |
|---|---|---|---|---|---|
| wa1 | 0c9dda13-428c-492b-900b-f48562111f93-WOS | file_explorer | Create a new folder named "Archive" in the Documents folder and move all .docx files into it. | Documents→沙箱目录；.docx 由 setup 本地生成（原为云端下载）；"全部 .docx"=setup 所置 3 个 | is_all_docx_in_archive 同义 PS 重写 |
| wa2 | e27984c7-968c-48d7-b2c3-6e45cdcc5249-WOS | file_explorer | Set the file "secret.txt" in the Documents folder as hidden. | Documents→沙箱目录；文件本地生成 | is_file_hidden 同义 PS 重写 |
| wa3 | 44dbac63-32bf-4cd2-81b4-ad6803ec812d-WOS | microsoft_paint | Change the canvas size to 800x600 pixels. | 原判定靠 postconfig 强存+读图；本地化：setup 置 300×200 小图并由任务提示打开，完成后另存为指定 png，oracle 读 PNG 尺寸 | 尺寸判定同义重写（800×600） |
| wa4 | 3544ac9a-6aee-4a0b-a203-bc7b59b272b6-WOS | microsoft_paint | Save the Paint image as "circle.png" in the downloads folder | Downloads→沙箱目录；setup 置待存图 | vm_file_exists 同义重写 + PNG magic 校验 |
| wa5 | 016c9a9d-f2b9-4428-8fdb-f74f4439ece6-WOS | file_explorer | Search for all files with the extension .png in the Pictures folder and list their full names in png_files.txt in the same folder. | Pictures→沙箱目录；png 由 setup 本地生成 | all_png_file_names 同义重写（集合匹配） |
| wa6 | 28b91a24-5d97-4c2a-891c-dccbd3820c62-WOS-2 | windows_calc | ...how many days are between Jan 3, 2024 and Aug 20 2024? Save the result in a file called 'numdays.txt' on the Desktop (e.g. X days) | Desktop→沙箱目录；金标 "230 days" 由本地日历计算复核（2024-01-03→2024-08-20 = 230 天，非闰年争议日，PS 验证） | is_file_saved_desktop 同义重写 |

### 弃选留档（R6）

- **chrome/msedge 全部（30 条）**：网络与登录态依赖，判定不可本地确定性化。
- **clock（4）**：定时器/世界时钟无 PS 可读的持久判定面。
- **settings（5）**：判定可行（注册表）但任务本身**改动用户真实系统配置**（时区/通知/夜间模式/壁纸），违反沙箱原则。
- **vlc（21）/ vs_code（24）/ libreoffice（43）**：本机未装或版本不可控，setup 无法零网络预置。
- **file_explorer 其余**：zip 加密（b0c9dac6 依赖 7-zip）、共享权限（b12921b2 改真实 ACL）、回收站还原（f934d80d 状态不可预置）等，判定或预置不可确定性化。
- **notepad 两条**：366de66e 与自编 t01 语义重合（镜像退化，R6）；a7d4b6c5 依赖下载 largefile.txt，本地化后与 t02 重合。

## 许可

WAA 任务语义（instruction/判定意图）来自 microsoft/WindowsAgentArena（MIT License，见 Public/waa-upstream/LICENSE）；本地化条目按 MIT 附源链接与原 ID 溯源，不复制其代码与资产文件。
