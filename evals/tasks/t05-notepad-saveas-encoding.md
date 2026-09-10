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

## 优化记录（2026-09-09，基线后）

- **预置**：setup 写好源文件并已用记事本打开（原来 agent 要启动+输入文字）。
- **保留**：另存为对话框（路径输入 + 编码下拉 + 保存）——这正是基线暴露的最大能力缺口，必须继续测。
- **oracle 未改**。
