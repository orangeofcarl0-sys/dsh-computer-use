# t04 · calculator-multiply

- group: authored
- **tier: smoke**（冒烟组：单窗口、判定面稳定）
- tools: screen_observe / computer_click / computer_type / computer_key
- sandbox: 无文件产物
- oracle: UIA 读计算器显示值 == 7006652（千分位剥除）

## Prompt

<<<PROMPT
计算器已经打开。请计算 1234 × 5678 的结果，完成后保持计算器窗口打开（不要关闭）。
PROMPT>>>

## 优化记录（2026-09-09，基线后）

- **预置**：setup 启动计算器并等待窗口（原来 agent 要自己启动）。
- **保留**：多步计算操作 + UIA 结果读取（唯一的“确定性数值断言”任务）。
- **oracle 未改**。基线上唯一 pass；即便 73 步也因为键盘输入路径而收敛。
