# t07 · window-maximize

- group: authored
- **tier: smoke**（冒烟组：已验证 14-18 步/4-5 分钟）
- tools: screen_observe / computer_click(最大化按钮) 或 perform_action
- sandbox: `%USERPROFILE%\.dsh\s4-evals\t07\`
- oracle: workfile.txt 记事本窗口 GetWindowPlacement.showCmd == SW_SHOWMAXIMIZED(3)

## Prompt

<<<PROMPT
当前已经打开了一个 workfile.txt 的记事本窗口。请把这个窗口最大化并保持最大化状态（不要关闭、不要还原）。
PROMPT>>>

## 备注

- **对 spec §3 表的 reshape**：原设想"最大化→记录→还原"的状态序列无法在单次 oracle 里确定性证明"曾最大化"（空跑与真做终态同形，永真风险）；降为"最大化并保持"，oracle 判 showCmd==3，唯一可判定。
- setup 启动 notepad 打开 workfile.txt（标题含唯一标记，cleanup 按标题精准关闭）。
- 基线注：t07 的 fail 经轨迹分析改判为**环境级联**（agent 观察并最大化了 t06 的残留窗口，非能力问题）——环境净化后需重测。
