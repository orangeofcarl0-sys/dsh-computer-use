# t09 · paint-draw-save

- group: authored
- difficulty: hard
- tools: app_launch(画图) / screen_observe / computer_click / computer_drag / 画布尺寸对话框 / 填充
- sandbox: `%USERPROFILE%\.dsh\s4-evals\t09\`
- oracle: PNG 存在 + 尺寸 == 200×150 + ≥90% 像素为纯红(R>240, G<15, B<15)

## Prompt

<<<PROMPT
打开画图，把画布设置为 200×150 像素并整张填充为纯红色（RGB 255,0,0），保存为 {task_dir}\out\paint.png（PNG 格式）。
PROMPT>>>

## 备注

- 画布 200×150：画图的"图像大小/画布属性"对话框可输入精确像素；填充用油漆桶（前景色选纯红）。
- oracle 用 System.Drawing 逐像素扫描（System.Drawing 在进程内做，非 GUI）。
- simulate 直接 New-Png 200×150 纯红。
