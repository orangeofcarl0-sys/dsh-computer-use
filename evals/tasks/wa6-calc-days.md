# wa6 · calc-days（WAA 本地化）

- group: waa
- waaId: `28b91a24-5d97-4c2a-891c-dccbd3820c62-WOS-2`（windows_calc, WindowsAgentArena MIT）
- 原 instruction: "Use the calculator app, how many days are there between 13/01/2023 and 20/08/2024? Can you save the answer in 'numdays.txt' on the Desktop (e.g. X days)"
- 原判定: is_file_saved_desktop（content "230 days" 精确匹配）；本仓库判定: PS 重写（含 230 且含 days/天 单位，格式宽容）。
- 本地化改动: Desktop→沙箱 `{task_dir}\Desktop`；日期取同族另一变体（Jan 3, 2024 → Aug 20, 2024 = 230 天，本地复核过：28+29+31+30+31+30+31+20=230）；金标与原任务一致为 "230 days"。
- difficulty: hard
- sandbox: `%USERPROFILE%\.dsh\s4-evals\wa6\`

## Prompt

<<<PROMPT
用 Windows 计算器的日期计算功能，计算 2024 年 1 月 3 日 与 2024 年 8 月 20 日 之间相差多少天。把结果写入 {task_dir}\Desktop\numdays.txt，内容格式如：230 days
PROMPT>>>
