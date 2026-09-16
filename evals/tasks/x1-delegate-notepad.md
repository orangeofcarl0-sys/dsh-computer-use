# x1 · delegate-notepad（委派通道集成验证）

- group: authored
- tier: core
- 用途：验证 `computer_task` 子 agent 委派通道端到端可用（PLAN-context-budget F 的真机补验）。
- oracle: 目标文件存在 + 内容逐字匹配（与 t01 同判定，但**执行路径由子 agent 完成**）
- sandbox: `%USERPROFILE%\.dsh\s4-evals\x1\`

## Prompt

<<<PROMPT
请把一行文字保存为文本文件：

HELLO-DELEG

保存位置：{task_dir}\target\deleg.txt
提示：这件事可以整体委派给 computer_task（子 agent 只能用桌面工具），你也可以自己操作，二者皆可。
PROMPT>>>

## 备注

- 该任务**不校验走哪条路径**（委派或亲自动手都算通过），oracle 只看文件终态。
- 若走委派：主上下文应只出现一条 ≤400 字符回执；子 agent 的观察/动作留在它自己的会话里（可在会话列表看到 parentSession 指向本次主会话）。
