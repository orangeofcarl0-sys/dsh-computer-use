# t01 · notepad-save

- group: authored
- **tier: smoke**（冒烟组：日常回归必跑）
- tools: screen_observe / computer_type / computer_key / computer_verify
- sandbox: `%USERPROFILE%\.dsh\s4-evals\t01\`
- oracle: 目标文件存在 + 内容逐字匹配（CRLF 归一）

## Prompt

<<<PROMPT
当前已打开一个空白记事本窗口。请把下面两行文字原样输入进去（不要增删、修改任何字符）：

S4-T01 line one.
S4-T01 line two.

然后保存到 {task_dir}\target\note.txt。
PROMPT>>>

## 驱动层限制（2026-09-16 实测，upstream trycua/cua#3908）

- WinUI3 目标（Win11 记事本）上驱动的 `hotkey` 通道稳定失败（UIA 加速器扫描 4s 超时），`press_key` 静默不达，`invoke_menu` 报 menu_path_unavailable。
- 因此本任务的**保存/粘贴动作需走界面控件**（点击菜单项/工具栏或使用剪贴板工具后输入）——oracle 只看终态，不限定路径；runner 的统一约束已要求 agent 在路径不可用时改用等效控件。
- 对照：经典 Win32 目标（如注册表编辑器）上 hotkey 正常 3/3，说明这是目标类型特异性问题，非本机输入栈故障。

## 优化记录（2026-09-09，基线后）

- **预置**：setup 负责启动空白记事本（原来由 agent 启动）。
- **保留**：文字输入、路径保存、内容判定的完整闭环。
- **oracle 未改**。预计步数从 25 降到 ~15。
