# t03 · explorer-rename

- group: authored
- **tier: core**（核心组：低频跑，重要的文件管理能力）
- tools: screen_observe / computer_key(F2) 或右键菜单 / computer_type
- sandbox: `%USERPROFILE%\.dsh\s4-evals\t03\`
- oracle: 旧名不存在 + 新名存在 + 内容不变

## Prompt

<<<PROMPT
资源管理器已打开 {task_dir}\files 目录，其中有 report-q7.txt。请把它重命名为 report-q7-final.txt。
PROMPT>>>

## 优化记录（2026-09-09，基线后）

- **预置**：setup 写文件 + 把资源管理器停在目标目录（原来 agent 要自己导航到深层沙箱路径——基线 59 步 timeout 的主因）。
- **保留**：重命名操作本身（F2/右键）、终态判定。
- **oracle 未改**。重命名能力的价值在于“对已有文件对象做就地操作”，与新建文件（t01）互补。
