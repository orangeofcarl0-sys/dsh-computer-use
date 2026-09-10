# t01 · notepad-save

- group: authored
- **tier: smoke**（冒烟组：日常回归必跑）
- tools: screen_observe / computer_type / computer_key / computer_verify
- sandbox: `%USERPROFILE%\.dsh\s4-evals\t01\`
- oracle: 目标文件存在 + 内容逐字匹配（CRLF 归一）

## Prompt

<<<PROMPT
当前已打开一个空白记事本窗口。请把下面两行文字原样输入进去（不要增删、修改任何字符）：

S4-T01 line one.
S4-T01 line two.

然后保存到 {task_dir}\target\note.txt。
PROMPT>>>

## 优化记录（2026-09-09，基线后）

- **预置**：setup 负责启动空白记事本（原来由 agent 启动）。
- **保留**：文字输入、路径保存、内容判定的完整闭环。
- **oracle 未改**。预计步数从 25 降到 ~15。
