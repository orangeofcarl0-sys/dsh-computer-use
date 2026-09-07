# t02 · find-replace

- group: authored
- difficulty: medium
- tools: app_launch / screen_observe / computer_type / computer_key（查找替换对话框或手动编辑）
- sandbox: `%USERPROFILE%\.dsh\s4-evals\t02\`
- oracle: 原词 alpha 0 处、beta 5 处、首行语义匹配

## Prompt

<<<PROMPT
用记事本打开 {task_dir}\docs\invoice.txt，把文中所有的 alpha 替换为 beta，然后保存。
PROMPT>>>

## 备注

- setup 预置 3 行文本，alpha 恰好 4 处；oracle 校验替换后 0/4 计数 + 首行 "beta is the first word"。
- 全 ASCII 内容，编码无关。
