# t03 · explorer-rename

- group: authored
- difficulty: medium
- tools: app_launch(资源管理器) / screen_observe / double_click / computer_type / computer_key(F2)
- sandbox: `%USERPROFILE%\.dsh\s4-evals\t03\`
- oracle: 旧名不存在 + 新名存在 + 内容不变

## Prompt

<<<PROMPT
在文件资源管理器中，把 {task_dir}\files\report-q7.txt 重命名为 report-q7-final.txt。
PROMPT>>>

## 备注

- 方法不限（F2/右键重命名），oracle 只看终态；插件无文件工具，GUI 是唯一路径。
