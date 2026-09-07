# wa1 · archive-docx（WAA 本地化）

- group: waa
- waaId: `0c9dda13-428c-492b-900b-f48562111f93-WOS`（file_explorer, WindowsAgentArena MIT）
- 原 instruction: "Create a new folder named "Archive" in the Documents folder and move all .docx files into it."
- 原判定: is_all_docx_in_archive（Python）；本仓库判定: PS 重写（Archive 存在 + 3 个 docx 全在内 + 外无 docx 残留）
- 本地化改动: Documents→沙箱 `{task_dir}\Documents`；.docx 由 setup 本地生成（原为云端下载 3 个文件）；"所有 .docx"=setup 所置 3 个。
- difficulty: medium
- sandbox: `%USERPROFILE%\.dsh\s4-evals\wa1\`

## Prompt

<<<PROMPT
在 {task_dir}\Documents 里新建一个名为 Archive 的文件夹，并把 {task_dir}\Documents 下所有 .docx 文件移动到 Archive 文件夹里。
PROMPT>>>
