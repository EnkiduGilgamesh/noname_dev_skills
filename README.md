# noname-general-extension

> 《无名杀》（noname）武将扩展开发技能包 —— 让 AI Agent 能在 **6700+ 个已有技能**中定位参考实现，把每次开发结论**沉淀成可复用、可校验的知识**，并在改完代码后**静态验证**是否写对。

[《无名杀》](https://github.com/libnoname/noname) 是一个开源的三国杀-like 卡牌游戏，本体 + 扩展共有约 6700 个技能、12 MB 技能源码。为它写武将技能时，最大的困难不是语法，而是**不知道某个效果别人是怎么写的**。

这个仓库提供一个可移植的 DSH Skill + 零依赖 CLI 工具集，解决五件事：

| 问题 | 解法 |
|------|------|
| **找不到参考实现** | 语义检索 6700+ 技能，支持中文长句与英文字段名 |
| **改技能时找不全位置** | `locate` 一次给出实现/描述/所属武将/影响面 |
| **重复踩同一个坑** | 增量知识库，每条结论带**源码指纹**，源码变了自动失效 |
| **不知道写得对不对** | 静态验证：武将悬空引用、缺描述、编码、描述与实现不一致 |
| **写了扩展但游戏里看不到** | 扩展注册诊断与修复 |

---

## 特性

- **零依赖** —— 只用 Node.js 内置模块，Node ≥ 18 即可
- **可移植** —— 源码约 212 KB（不含索引），拷到任何《无名杀》仓库都能用
- **自定位** —— 脚本动态解析项目根，不含任何硬编码路径
- **不会误导** —— 知识库条目绑定源码指纹，源码变动即标记失效并跳过
- **低误报验证** —— 每条检查都带排除规则，只报能确证的问题
- **自带迁移自检** —— 一条命令扫描硬编码路径、外部依赖、位置假设

---

## 安装

### 方式一：直接 clone 到技能目录（推荐）

把本仓库**整体克隆到技能安装位置**，使仓库本体即技能本体。
这样在工作目录内即可同时开发游戏和技能包，无需跨目录操作：

```bash
git clone <本仓库> <无名杀项目>/.dsh/skills/noname-general-extension

cd <无名杀项目>/.dsh/skills/noname-general-extension
node scripts/build-index.mjs       # 构建索引（10–30 秒）
node scripts/skill-search.mjs stats  # 验证
```

DSH 会自动发现该 Skill（名称 `noname-general-extension`）。

> `install.mjs` 检测到"源即目标"时会**直接跳过复制**并提示维护流程，
> 不会自我覆盖。（`--force` 下若不加此保护会清空 `knowledge-base.json`。）

### 方式二：安装到已有项目（仓库在别处）

仓库放在别处、只想把技能装进项目时，用 `install.mjs`：

```bash
git clone <本仓库> /tmp/nge
node /tmp/nge/install.mjs --target <无名杀项目根>
```

| 选项 | 作用 |
|------|------|
| `--target <路径>` | **必填**。《无名杀》项目根（须含 `apps/core/noname`） |
| `--force` | 覆盖已存在的文件（默认跳过） |
| `--no-index` | 不自动构建索引 |

安装到 `<项目根>/.dsh/skills/noname-general-extension/`。

> 知识库 `knowledge-base.json` 在目标已存在时**默认保留**（不覆盖），避免丢失本机沉淀的结论；
> 需要覆盖请加 `--force`。

### 方式三：手动复制

```bash
git clone <本仓库> /tmp/nge
mkdir -p <无名杀项目>/.dsh/skills/noname-general-extension
cp -r /tmp/nge/SKILL.md /tmp/nge/README.md /tmp/nge/LICENSE \
      /tmp/nge/scripts <无名杀项目>/.dsh/skills/noname-general-extension/

cd <无名杀项目>/.dsh/skills/noname-general-extension/scripts
node build-index.mjs          # 构建索引（10–30 秒）
node skill-search.mjs stats   # 验证
```

### 方式四：作为独立工具使用（不放进项目）

```bash
node scripts/build-index.mjs --root <无名杀项目根>
node scripts/skill-search.mjs search "出牌阶段限一次" --root <无名杀项目根>
```

---

## 使用

```bash
cd scripts

# ═══ 检索参考实现 ═══
node skill-search.mjs search "摸牌阶段多摸一张牌"
node skill-search.mjs search "viewAs" --impl      # 找所有视为技
node skill-search.mjs locate 天妒                  # 改技能：一次拿到全部坐标
node skill-search.mjs show drlt_jieying           # 看实现（带行号源码）
node skill-search.mjs similar rb_jiying           # 找结构类似的

# ═══ 写完后验证 ═══
node verify-skill.mjs --pack <扩展名>              # 静态验证
node skill-search.mjs rebuild                     # 重建索引

# ═══ 沉淀结论 ═══
node skill-search.mjs learn \
  --title "限定技必须调用 awakenSkill" \
  --body  "仅设 limited:true 不够，需在 content 中 await player.awakenSkill(id)" \
  --kind pitfall --from zga_luanming

# ═══ 知识库管理 ═══
node skill-search.mjs kb list      # 全部条目（含失效状态）
node skill-search.mjs kb check     # 只看失效的
node skill-search.mjs kb stats
```

### 命令一览

| 命令 | 作用 |
|------|------|
| `search <语义>` | 语义检索（先查知识库，再查索引） |
| `locate <ID或中文名>` | 改技能：实现/描述/所属武将/影响面一站式定位 |
| `show <技能ID>` | 查看技能元信息 + 带行号完整源码 |
| `similar <技能ID>` | 找结构相似的技能 |
| `learn` | 沉淀一条结论到知识库 |
| `kb {list,check,show,forget,stats}` | 知识库管理 |
| `stats` / `rebuild` | 索引统计 / 重建 |
| `verify-skill.mjs` | 技能静态验证（悬空引用/缺描述/编码） |
| `register-extension.mjs` | 扩展注册诊断与修复 |
| `migrate-skill.mjs` | 打包迁移与可移植性自检 |

### 验证

```bash
node verify-skill.mjs --pack 英雄杀RE     # 有错误时退出码 1
node verify-skill.mjs --json
```

| 级别 | 检查 |
|------|------|
| ✗ 错误 | 武将引用了不存在的技能 ID（选将可见但技能无效） |
| ⚠ 警告 | 技能缺描述（排除子技能/`_`前缀/派生技能）、文件编码非 UTF-8 |
| · 提示 | 描述与实现不一致、子技能未挂载 |

**静态验证查不到**（必须实机确认）：技能是否真的触发、UI 结算、AI 行为、数值平衡。

### search 常用选项

| 选项 | 说明 |
|------|------|
| `--limit N` | 返回条数，默认 12 |
| `--source X` | `character` / `extension` / `core` / `all` |
| `--impl` | 仅返回有实现的技能 |
| `--no-kb` | 跳过知识库 |
| `--root <路径>` | 显式指定项目根 |
| `--json` | JSON 输出 |

---

## 增量知识库

（详见 `scripts/README.md`）

### 核心机制：证据指纹

每条知识记录其依据的**源码位置 + 内容哈希**。读取时重新计算：

| 状态 | 含义 | 行为 |
|------|------|------|
| `fresh` | 指纹一致 | 正常命中 |
| `stale` | 源码已变动 | **跳过并警告**，回退索引检索 |
| `missing` | 依据文件不存在 | 同上 |

**知识库只会加速，不会误导。**

### 知识类型

`pattern`（写法）· `pitfall`（坑点）· `recipe`（需求→推荐技能）· `fact`（项目事实）

---

## 迁移到其他机器

```bash
node migrate-skill.mjs pack     # 打包（约 124 KB，不含索引）
node migrate-skill.mjs check    # 可移植性自检
```

**注意**：`skill-index.json` **不要**跨机器拷贝 —— 它是派生产物，且内含构建时的绝对路径。到新机器后重建即可。

---

## 目录结构

```
.                                # ← 本目录即 git 仓库根，也是技能安装位置
├── SKILL.md                    # 技能主体（Agent 读取的指令）
├── README.md                   # 本文件
├── LICENSE                     # MIT
├── install.mjs                 # 安装脚本（源≠目标时才复制；同位置时自动跳过）
├── package.json                # bin / files 定义
├── .gitignore                  # 排除索引与本机说明
└── scripts/
    ├── README.md               # 工具详解
    ├── skill-search.mjs        # 检索引擎 + 定位 + 知识库 CLI
    ├── build-index.mjs         # 索引构建器
    ├── verify-skill.mjs        # 技能静态验证
    ├── knowledge.mjs           # 知识库模块（指纹计算/校验）
    ├── register-extension.mjs  # 扩展注册与修复
    ├── migrate-skill.mjs       # 迁移打包与自检
    └── knowledge-base.json     # 知识沉淀（应入库）
```

**不入库的生成物 / 本机文件**（已在 `.gitignore` 排除）：

| 文件 | 原因 |
|------|------|
| `scripts/skill-index.json`（约 6.5 MB） | 派生产物，含构建时的绝对路径；用 `build-index.mjs` 重建 |
| `PATHS-LOCAL.md` | 记录本机特有的端口/环境，不随包分发 |
| `scripts/register-*.js` | 扩展注册 Console 脚本，用 `register-extension.mjs` 重新生成 |

---

## 环境要求

- **Node.js ≥ 18**（无外部依赖）
- 一个《无名杀》源码仓库（用于索引源码；工具本身不需要它也能运行 `--help`）

---

## 原理

技能定义在《无名杀》源码中的形态高度规整：

```
顶层技能：1 个 Tab 缩进 + `name: {`
子技能：  2 个 Tab 缩进
```

索引器用**花括号配平**（跳过字符串与注释）定位块边界，提取技能 ID、描述、触发时机、结构特征与关键 API 调用。

一个实测样本（《无名杀》1.11.7）：

| 指标 | 数值 |
|------|------|
| 技能总数 | 6703 |
| 含描述 | 5615（83.8%） |
| 来源分布 | 武将包 5329 · 扩展 1318 · 本体 56 |

> 技能数随目标仓库内容变化，以上仅供参考，以 `node skill-search.mjs stats` 为准。

---

## 配套文档：`docs/YRD/`

`SKILL.md` 引用 `docs/YRD/`（事件系统 18 篇 + 11 类技能模板）。
该目录属于 **《无名杀》仓库本体**，**不在本技能包内**、也不由安装脚本提供。

若目标仓库缺该目录，可跳过文档步骤，改用仓库自带的
`docs/game-event/`、`docs/lib-skill-format.md`，或直接用检索工具找真实实现。

---

## 维护本技能包

本技能包设计为**在开发任务中持续增值**，而不是一次性工具。每次任务结束前检查四类更新：

| 类型 | 何时更新 | 落到哪里 |
|------|---------|---------|
| **Skill 本身** | 发现约定过时、文档与源码不符 | `SKILL.md` |
| **知识库** | 每次开发沉淀 ≥1 条结论 | `scripts/knowledge-base.json` |
| **新工具** | 现有脚本不够用 | `scripts/` + 四处清单 |
| **README** | 数字/命令/结构变化 | `README.md`、`scripts/README.md` |

### 推荐布局：仓库即技能目录

本仓库推荐**直接位于技能安装位置**：

```
<无名杀项目>/.dsh/skills/noname-general-extension/   ← 本仓库（含 .git）
```

这样**仓库本体与技能运行时是同一个目录**，好处：

- 修改立即生效，**无需复制/同步**，不存在"改错副本"的问题
- 游戏项目与技能包在**同一个工作目录**下，一次操作两边都能维护
- 无需跨目录授权（在受限环境下尤其重要）

> 该目录已被《无名杀》项目的 `.gitignore`（`.dsh/` 规则）忽略，
> 因此**不会污染游戏仓库的 git 状态**，两个仓库相互独立。
>
> 旧的"源仓库 + 安装副本"双位置模式仍然支持（见「安装 · 方式二/三」），
> 但需要每次改完用 `install.mjs --force` 回流，容易漏。

### 日常维护流程

```bash
cd <无名杀项目>/.dsh/skills/noname-general-extension

# 1. 改动后自查（须 0 问题）
node scripts/migrate-skill.mjs check

# 2. 若动了工具/SKILL.md，重建索引
node scripts/build-index.mjs

# 3. 本地提交
git add -A && git commit -m "<type>(<scope>): <说明>"

# 4. 报告待推送内容，等用户确认后再推
git push origin main
```

**本地 commit 是安全的；push 是对外发布，必须经用户确认。**

提交信息 type：`feat`（新工具）· `fix`（修正错误）· `docs`（文档）· `kb`（知识库）。

### 双仓库协同

| 仓库 | 位置 | 提交到哪 |
|------|------|---------|
| **游戏本体** | `<无名杀项目>/` | 上游 `noname`（只改 `docs/` 等本地资产） |
| **本技能包** | `<无名杀项目>/.dsh/skills/noname-general-extension/` | 本仓库 origin |

两者 git 状态互不干扰：技能包在 `.dsh/` 下，被游戏仓库忽略；
在技能包目录内执行 `git` 命令只影响技能包仓库。

详细流程见 `SKILL.md` §12。

---

## 许可

工具与文档以 MIT 许可发布。

《无名杀》本体为 GPL-3.0，本仓库不包含其源码。
