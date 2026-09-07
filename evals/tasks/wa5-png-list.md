# wa5 · png-list（WAA 本地化）

- group: waa
- waaId: `016c9a9d-f2b9-4428-8fdb-f74f4439ece6-WOS`（file_explorer, WindowsAgentArena MIT）
- 原 instruction: "Search for all files with the extension .png in the Pictures folder and list their full names in png_files.txt in the same folder."
- 原判定: all_png_file_names（Python 集合比对）；本仓库判定: PS 重写（txt 内 4 个 png 名全在 + 诱饵文件名不出现）。
- 本地化改动: Pictures→沙箱 `{task_dir}\Pictures`；png 由 setup 本地生成 4 个（alpha-001/beta-002/gamma-003/delta-004）+ 2 个诱饵（notes.txt/cover.jpg）——诱饵使"过滤"语义可判（原任务目录混有非 png 与否未知，判定面弱）。
- difficulty: medium
- sandbox: `%USERPROFILE%\.dsh\s4-evals\wa5\`

## Prompt

<<<PROMPT
{task_dir}\Pictures 里放有若干文件。请找出其中所有 .png 文件，把它们各自的完整文件名（含 .png 扩展名）逐行写入 {task_dir}\Pictures\png_files.txt。其他扩展名的文件不要写进去。
PROMPT>>>
