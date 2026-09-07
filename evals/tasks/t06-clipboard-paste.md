# t06 · clipboard-paste

- group: authored
- difficulty: easy
- tools: app_launch / computer_clipboard 或 ctrl+v / computer_type / computer_key
- sandbox: `%USERPROFILE%\.dsh\s4-evals\t06\`
- oracle: 目标文件内容 == 剪贴板预置原值

## Prompt

<<<PROMPT
我已把一段文字放入剪贴板。请新建记事本，把剪贴板内容粘贴进去，保存为 {task_dir}\out\pasted.txt（内容必须与剪贴板原值一致）。
PROMPT>>>

## 备注

- setup 用 Set-Clipboard 预置 payload：`S4-CLIP-6f3a9b payload line`；oracle 读文件逐字比对。
- 剪贴板为唯一信息源，文件内容全 ASCII。
