# t04 · calculator-multiply

- group: authored
- difficulty: medium
- tools: app_launch(计算器) / screen_observe / computer_click / computer_type / computer_key
- sandbox: `%USERPROFILE%\.dsh\s4-evals\t04\`（无文件产物）
- oracle: UIA 读计算器显示值 == 7006652（CalculatorResults 自动化元素，千分位剥除）

## Prompt

<<<PROMPT
打开 Windows 计算器，计算 1234 × 5678 的结果。得出结果后保持计算器窗口打开，不要关闭。
PROMPT>>>

## 备注

- oracle 找 ClassName=ApplicationFrameWindow 的顶层窗口，再在其中找 AutomationId=CalculatorResults，读 Name（"显示为 7,006,652" / "Display is ..."）剥出数字。
- simulate 用 SendKeys 驱动真实计算器造成功态（独立于插件，AC2 双向验证用）。
- cleanup 负责 kill CalculatorApp.exe（防跨任务残留）。
