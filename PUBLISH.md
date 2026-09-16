# dsh-computer-use 发布清单（PUBLISH）

> 状态更新：2026-09-17 · **v0.5.4 已发布**：`v0.3` 与默认分支 `main` 均指向 `fc7aae2`；注解 tag `v0.5.4` 指向发布提交 `b967698`（其后一条 `fc7aae2` 只补发布记录文档）。
> 发布前 check 全绿：`npm run check` / `npm test`（148 断言）/ `verify-runtime.mjs`（14/14）/ `tests/live-action.e2e.mjs`（23/23，重设计后）/
> `evals/verify-oracles.mjs`（10/10，首次 t04 因遗留计算器窗口失败、清理后复跑通过）/ `npm pack --dry-run`（28 文件，无内部文档）。
> npm 发布与 awesome 收录仍未做，见文末。

## 发布口径（2026-09-17 确立）

| 项 | 约定 |
|---|---|
| 版本号 | `package.json` / `package-lock.json` 的 `version` = tag 名（去掉 `v`）；CHANGELOG 顶部为该版本一节 |
| 发布载体 | 工作分支 `v0.3`（默认分支 `main` 是其祖先，发布时快进对齐） |
| tag | **注解 tag**（`git tag -a v0.5.4 -m "…"`），历史 tag 均为注解 tag |
| push 授权 | **仅用户明说「发布」时执行**；本地提交自主（见 HANDOFF 工作约定 5） |
| 发布前 check | 见下节「发布前 check」，全绿才动 push |

## 发布前 check（逐项跑，看退出码不看输出）

```bash
# 0. 工作树必须干净（发布物 = 提交，不是工作区）
git status --short

# 1. 语法 + 安装脚本
npm run check

# 2. 离线测试（七套 148 断言；&& 串联，必须看 $?，别只 grep 输出）
npm test; echo "exit=$?"

# 3. 真驱动运行时验证（真实 cua-driver + harness）
node verify-runtime.mjs

# 4. 真桌面动作闭环（真记事本 3 轮；自带清理，按标题匹配）
node tests/live-action.e2e.mjs 3

# 5. S4 评测 oracle 双向验证（setup 必 ok → 空跑必失败 → simulate 必过 → cleanup 干净）
node evals/verify-oracles.mjs

# 6. 打包面预检：确认 npm 包里只有运行面文件（无内部项目书/测试/文档草稿）
npm pack --dry-run

# 7. 文档一致性（版本号 / 工具数 / 默认值三处对齐）
grep -n '"version"' package.json package-lock.json
grep -rn "个模型友好工具\|20 个工具" README.md package.json docs/store-evidence.md
```

历史上真正抓出过问题的两类检查：**schema 严格校验（`schema.conformance`）**与**真机闭环（`live-action.e2e`）**——前者抓到过工具输出 schema 缺口、结构化拒绝误报成功；后者抓到过 Windows 前台锁与 XAML 输入通道问题。

## 发布步骤

```bash
# 1. 收尾提交（版本号、CHANGELOG、文档）
git add -A && git commit -m "0.5.4 …"

# 2. 推送工作分支
git push origin v0.3

# 3. 注解 tag（标题即发布说明首行）
git tag -a v0.5.4 -m "0.5.4：dsh 0.1.5 适配 + 坐标契约根治 + 观察降噪/上下文预算 A–F + S4 评测系统 + 结构治理"
git push origin v0.5.4

# 4. 默认分支对齐（main 是 v0.3 的祖先，快进无冲突；GitHub 首页访问者才看得到新代码）
git push origin v0.3:main

# 5. 复核
git ls-remote --tags origin | grep v0.5.4
```

## ✅ 已完成：GitHub 仓库与收录

| 项 | 状态 |
|----|------|
| 仓库（现址）| `https://github.com/orangeofcarl0-sys/dsh-computer-use`（public，MIT） |
| 派生来源 | 由 [988hj7tczd-oss/dsh-computer-use](https://github.com/988hj7tczd-oss/dsh-computer-use) @ `07477f4` 按 MIT 派生，独立维护 |
| topics | `dsh-plugin` + `deepseek-harness` + `computer-use` + `cua-driver` + `ai-agents` |
| dsh-plugin topic 收录 | ✅ 已出现在 https://github.com/topics/dsh-plugin |
| 内部项目书 | ✅ 已从远程移除（`dsh-computer-use.md` 在 .gitignore；⚠️ 首次提交的历史里仍有，介意需 filter-repo 重写） |
| tag 历史 | v0.4.0 / v0.4.1 / v0.5.0 / v0.5.1 / v0.5.2 / v0.5.3 / **v0.5.4**（均为注解 tag；仓库未使用 GitHub Releases 页面，PUBLISH 视其为可选项）|

## ⏳ 待做：npm 发布（dsh-market 安装途径）

> dsh-market（插件市场）安装插件**优先走 npm tarball**。`dsh plugin add <包名>` 从 npm 解析；名称 `dsh-computer-use` 已验证可用，npm 账号已登录（jerryweizhihao）。**尚未发布**。

```bash
npm pack --dry-run          # 先看包里内容（files 字段见 package.json）
npm publish --access public # 需要 npm 2FA/token
npm view dsh-computer-use version
```

发布后 `dsh plugin --profile web add dsh-computer-use` 即可安装。

## ⏳ 待做：awesome-dsh-plugin 收录 PR

1. Fork [awesome-dsh-plugin/awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin)；
2. 在 `README.md` 与 `README.zh.md` 的合适分类各加一行（候选分类 `Tools & Capabilities` / 新增 `Computer Use`）：

```markdown
- [orangeofcarl0-sys/dsh-computer-use](https://github.com/orangeofcarl0-sys/dsh-computer-use) — 桌面操作插件：AX/UIA 编号树 + 原生截图直读，后台优先三级投递链，凭据硬保护
```

3. 提交 PR（仓库已加 `dsh-plugin` topic，满足收录要求）。

## ✅ 已完成：独立站引流（aibunkhouse.com，2026-08-15）

- [x] 教程资源分类发过一篇介绍文章（ID 279）
- [x] 工具页挂仓库链接（tools 表 + API 第 5 条 + featured）
- [ ] README 挂独立站链接（待做，可选）
