# wa2 · hide-file（WAA 本地化）

- group: waa
- waaId: `e27984c7-968c-48d7-b2c3-6e45cdcc5249-WOS`（file_explorer, WindowsAgentArena MIT）
- 原 instruction: "Set the file "secret.txt" in the Documents folder as hidden."
- 原判定: is_file_hidden（Python）；本仓库判定: PS 重写（attributes 含 Hidden 位）
- 本地化改动: Documents→沙箱 `{task_dir}\Documents`；secret.txt 由 setup 本地生成。
- difficulty: medium
- sandbox: `%USERPROFILE%\.dsh\s4-evals\wa2\`

## Prompt

<<<PROMPT
把 {task_dir}\Documents\secret.txt 设置为隐藏文件。
PROMPT>>>
