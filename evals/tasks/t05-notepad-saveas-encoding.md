# t05 · notepad-saveas-encoding

- group: authored
- difficulty: hard
- tools: app_launch / screen_observe / computer_type / computer_menu(另存为) / save 对话框 + 编码下拉
- sandbox: `%USERPROFILE%\.dsh\s4-evals\t05\`
- oracle: 文件存在 + 无 UTF-8 BOM（前 3 字节 != EF BB BF）+ ANSI 读回内容逐字匹配

## Prompt

<<<PROMPT
打开记事本，输入这一行文字：

S4-T05 ANSI check.

然后把文件另存为 {task_dir}\saveas\out-ansi.txt，编码选择 ANSI（另存为对话框里的"编码"下拉框），保存。
PROMPT>>>

## 备注

- Win11 记事本另存为对话框右侧有"编码"下拉（默认 UTF-8）；选 ANSI 后落盘无 BOM。
- oracle：读前 3 字节验非 BOM；用 Default(ANSI) 解码比对内容。ASCII-only 内容保证两种编码读法一致。
