# t09 · paint-draw-save

- group: authored
- **tier: core**（核心组：图形应用表面，多步 canvas 操作）
- tools: screen_observe / computer_click / 画布尺寸对话框 / 填充工具 / 另存为
- sandbox: `%USERPROFILE%\.dsh\s4-evals\t09\`
- oracle: PNG 存在 + 尺寸 == 200×150 + ≥90% 像素为纯红(R>240, G<15, B<15)

## Prompt

<<<PROMPT
画图已经打开。请把画布设置为 200×150 像素并整张填充为纯红色（RGB 255,0,0），保存为 {task_dir}\out\paint.png（PNG 格式）。
PROMPT>>>

## 优化记录（2026-09-09，基线后）

- **预置**：setup 启动画图（原来 agent 要自己启动）。
- **保留**：画布尺寸设定 + 填充 + 另存为 PNG —— 多步图形操作 + 像素级 oracle，是任务集里唯一验证“图像产物内容”的一条。
- **oracle 未改**（像素扫描）。
