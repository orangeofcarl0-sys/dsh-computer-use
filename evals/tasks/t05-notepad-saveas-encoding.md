# t05 · notepad-saveas-encoding

- group: authored
- **tier: core**（核心组：覆盖“另存为对话框 + 编码下拉”这一已识别重灾区）
- tools: computer_key(ctrl+shift+s) / 另存为对话框 / computer_type / computer_menu
- sandbox: `%USERPROFILE%\.dsh\s4-evals\t05\`
- oracle: 文件存在 + 无 UTF-8 BOM（前 3 字节 != EF BB BF）+ ANSI 读回内容逐字匹配

## Prompt

<<<PROMPT
记事本已打开 {task_dir}\src\draft.txt。请把它另存为 {task_dir}\saveas\out-ansi.txt，编码选择 ANSI（另存为对话框里的"编码"下拉框）。
PROMPT>>>

## 驱动层限制（2026-09-16 实测，upstream trycua/cua#3908）

- WinUI3 目标（Win11 记事本）上驱动的 `hotkey` 通道稳定失败（UIA 加速器扫描 4s 超时），`press_key` 静默不达，`invoke_menu` 报 menu_path_unavailable。
- 因此本任务的**保存/粘贴动作需走界面控件**（点击菜单项/工具栏或使用剪贴板工具后输入）——oracle 只看终态，不限定路径；runner 的统一约束已要求 agent 在路径不可用时改用等效控件。
- 对照：经典 Win32 目标（如注册表编辑器）上 hotkey 正常 3/3，说明这是目标类型特异性问题，非本机输入栈故障。

## 优化记录（2026-09-09，基线后）

- **预置**：setup 写好源文件并已用记事本打开（原来 agent 要启动+输入文字）。
- **保留**：另存为对话框（路径输入 + 编码下拉 + 保存）——这正是基线暴露的最大能力缺口，必须继续测。
- **oracle 未改**。
