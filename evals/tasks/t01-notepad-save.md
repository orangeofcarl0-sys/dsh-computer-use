# t01 · notepad-save

- group: authored
- difficulty: easy
- tools: app_launch / screen_observe / computer_type / computer_key
- sandbox: `%USERPROFILE%\.dsh\s4-evals\t01\`
- oracle: 目标文件存在 + 内容逐字匹配（CRLF 归一）

## Prompt

<<<PROMPT
请把下面两行文字原样保存为一个新文本文件（不要增删、修改任何字符）：

S4-T01 line one.
S4-T01 line two.

保存位置：{task_dir}\target\note.txt
PROMPT>>>

## 备注

- 插件无文件读写工具，GUI 是唯一路径，oracle 只看终态是安全的（全集同理，不再重复）。
- 文件内容全 ASCII，规避记事本默认编码差异（Win11 UTF-8 vs 经典 ANSI）。
