# t08 · run-dialog-launch

- group: authored
- difficulty: easy
- tools: computer_key(Win+R) / computer_type / app 交互
- sandbox: `%USERPROFILE%\.dsh\s4-evals\t08\`
- oracle: hello.txt 存在 + 内容逐字匹配

## Prompt

<<<PROMPT
用"运行"对话框（Win+R 输入 notepad 回车）打开记事本，输入这一行文字：

S4-T08 hello from run dialog

然后保存为 {task_dir}\out\hello.txt。
PROMPT>>>

## 备注

- 启动通道（是否真的用 Win+R）oracle 无法判定——按判定原则不进 oracle，靠报告里的 sessionId 轨迹回查抽查；oracle 只看终态。
