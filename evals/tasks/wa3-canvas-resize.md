# wa3 · canvas-resize（WAA 本地化）

- group: waa
- waaId: `44dbac63-32bf-4cd2-81b4-ad6803ec812d-WOS`（microsoft_paint, WindowsAgentArena MIT）
- 原 instruction: "Change the canvas size to 800x600 pixels."
- 原判定: postconfig 强制 Ctrl+S 存盘后读图尺寸（pyautogui）；本仓库判定: agent 自己另存为指定 png，oracle 直接读 PNG 尺寸 == 800×600。
- 本地化改动: 原任务开空白画布；本地化 setup 生成 300×200 小图并由 prompt 指定打开（尺寸变化可证：300×200→800×600）；保存动作并入任务（原评测栈替 agent 存盘，不可取）。
- difficulty: hard
- sandbox: `%USERPROFILE%\.dsh\s4-evals\wa3\`

## Prompt

<<<PROMPT
用画图打开 {task_dir}\img\canvas-300x200.png，把画布尺寸改为 800×600 像素，然后另存为 {task_dir}\out\resized.png（PNG 格式，保持 800×600 尺寸）。
PROMPT>>>
