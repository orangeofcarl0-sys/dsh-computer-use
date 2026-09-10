# wa2 · hide-file（WAA 本地化）

- group: waa
- **tier: smoke**（冒烟组：WAA 溯源代表项，已预置到决策点）
- waaId: `e27984c7-968c-48d7-b2c3-6e45cdcc5249-WOS`（file_explorer, WindowsAgentArena MIT）
- 原 instruction: "Set the file "secret.txt" in the Documents folder as hidden."
- 原判定: is_file_hidden（Python）；本仓库判定: PS 重写（attributes 含 Hidden 位）
- 本地化改动: Documents→沙箱 `{task_dir}\Documents`；secret.txt 由 setup 本地生成。
- sandbox: `%USERPROFILE%\.dsh\s4-evals\wa2\`

## Prompt

<<<PROMPT
资源管理器已打开 {task_dir}\Documents 并选中了 secret.txt。请把它设置为隐藏文件。
PROMPT>>>

## 优化记录（2026-09-09，基线后）

- **预置**：setup 打开资源管理器并**用 /select 选中目标文件**（基线 73 步 timeout 的主因是 agent 靠 56 次双击逐层点进深层路径，从未试地址栏）。
- **保留**：属性/隐藏设置操作（右键菜单→属性→隐藏，或快捷键）。
- **oracle 未改**。本组由 6 条缩到 1 条（其余与自编组表面重复，见 README 退役表）。
