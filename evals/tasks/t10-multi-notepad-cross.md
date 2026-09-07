# t10 · multi-notepad-cross

- group: authored
- difficulty: hard
- tools: 多窗口 screen_observe / computer_clipboard / computer_type / computer_key
- sandbox: `%USERPROFILE%\.dsh\s4-evals\t10\`
- oracle: a.txt == b 原文 且 b.txt == a 原文（CRLF 归一）

## Prompt

<<<PROMPT
用记事本打开 {task_dir}\swap\a.txt 和 {task_dir}\swap\b.txt（两个窗口）。把两个文件的内容互换：a.txt 改为保存 b.txt 的原文内容，b.txt 改为保存 a.txt 的原文内容，然后分别保存两个文件。
PROMPT>>>

## 备注

- setup 预置 a='AAA-content-original-a'、b='BBB-content-original-b'；oracle 交叉比对。
- 考多窗口观察与剪贴板跨窗口搬运。
