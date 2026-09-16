# t06 · clipboard-paste

- group: authored
- **tier: core**（核心组：剪贴板是插件级能力，值得独立覆盖）
- tools: computer_clipboard 或 ctrl+v / computer_key / computer_type
- sandbox: `%USERPROFILE%\.dsh\s4-evals\t06\`
- oracle: 目标文件内容 == 剪贴板预置原值

## Prompt

<<<PROMPT
剪贴板里已放好一段文字，记事本也已打开。请把剪贴板内容粘贴进记事本，保存为 {task_dir}\out\pasted.txt（内容必须与剪贴板一致）。
PROMPT>>>

## 驱动层限制（2026-09-16 实测，upstream trycua/cua#3908）

- WinUI3 目标（Win11 记事本）上驱动的 `hotkey` 通道稳定失败（UIA 加速器扫描 4s 超时），`press_key` 静默不达，`invoke_menu` 报 menu_path_unavailable。
- 因此本任务的**保存/粘贴动作需走界面控件**（点击菜单项/工具栏或使用剪贴板工具后输入）——oracle 只看终态，不限定路径；runner 的统一约束已要求 agent 在路径不可用时改用等效控件。
- 对照：经典 Win32 目标（如注册表编辑器）上 hotkey 正常 3/3，说明这是目标类型特异性问题，非本机输入栈故障。

## 优化记录（2026-09-09，基线后）

- **预置**：setup 设好剪贴板 payload + 打开空白记事本（原来 agent 要自己启动记事本）。
- **保留**：取剪贴板（computer_clipboard 或 ctrl+v）→ 粘贴 → 保存的完整链路。
- **oracle 未改**。
