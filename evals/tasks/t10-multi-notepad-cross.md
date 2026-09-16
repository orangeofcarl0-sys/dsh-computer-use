# t10 · multi-notepad-cross

- group: authored
- **tier: core**（核心组：多文档协调——基线暴露的最大能力缺口，最该留的回归项）
- tools: 多窗口 screen_observe / computer_clipboard / computer_type / computer_key
- sandbox: `%USERPROFILE%\.dsh\s4-evals\t10\`
- oracle: a.txt == b 原文 且 b.txt == a 原文（CRLF 归一）

## Prompt

<<<PROMPT
两个记事本已经打开，分别载入 {task_dir}\swap\a.txt 和 {task_dir}\swap\b.txt（可能是两个窗口，也可能是同一窗口的两个标签页）。请把两个文件的内容互换：a.txt 改为保存 b.txt 的原文内容，b.txt 改为保存 a.txt 的原文内容，然后分别保存。
PROMPT>>>

## 驱动层限制（2026-09-16 实测，upstream trycua/cua#3908）

- WinUI3 目标（Win11 记事本）上驱动的 `hotkey` 通道稳定失败（UIA 加速器扫描 4s 超时），`press_key` 静默不达，`invoke_menu` 报 menu_path_unavailable。
- 因此本任务的**保存/粘贴动作需走界面控件**（点击菜单项/工具栏或使用剪贴板工具后输入）——oracle 只看终态，不限定路径；runner 的统一约束已要求 agent 在路径不可用时改用等效控件。
- 对照：经典 Win32 目标（如注册表编辑器）上 hotkey 正常 3/3，说明这是目标类型特异性问题，非本机输入栈故障。

## 优化记录（2026-09-09，基线后）

- **预置**：setup 生成两个文件并分别用记事本载入（原来 agent 要自己打开两个文件）。
- **保留**：跨文档剪贴板搬运 + 分别保存 —— 多窗口/多标签状态管理是基线里最有信息量的失败模式。
- **oracle 未改**。提示语明确“可能是两个窗口或两个标签页”，避免 Win11 记事本标签页行为造成任务前提失真。
