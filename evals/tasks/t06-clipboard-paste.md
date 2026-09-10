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

## 优化记录（2026-09-09，基线后）

- **预置**：setup 设好剪贴板 payload + 打开空白记事本（原来 agent 要自己启动记事本）。
- **保留**：取剪贴板（computer_clipboard 或 ctrl+v）→ 粘贴 → 保存的完整链路。
- **oracle 未改**。
