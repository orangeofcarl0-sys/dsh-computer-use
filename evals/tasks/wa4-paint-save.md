# wa4 · paint-save（WAA 本地化）

- group: waa
- waaId: `3544ac9a-6aee-4a0b-a203-bc7b59b272b6-WOS`（microsoft_paint, WindowsAgentArena MIT）
- 原 instruction: "Save the Paint image as "circle.png" in the downloads folder"
- 原判定: vm_file_exists（仅存在性）；本仓库判定: 存在性 + PNG magic 头（略强化，溯源表已记）
- 本地化改动: Downloads→沙箱 `{task_dir}\Downloads`（setup 预建）；setup 生成待存图 circle-src.png（原为空白 Paint）；保存动作由 agent 完成（原任务 agent 自己存，一致）。
- difficulty: medium
- sandbox: `%USERPROFILE%\.dsh\s4-evals\wa4\`

## Prompt

<<<PROMPT
用画图打开 {task_dir}\img\circle-src.png，把它另存为 {task_dir}\Downloads\circle.png（PNG 格式）。
PROMPT>>>
