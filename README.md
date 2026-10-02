# noname-general-extension

> 《无名杀》（noname）武将扩展开发技能包 —— 让 AI Agent 能在 **7200+ 个已有技能**中定位参考实现，并把每次开发结论**沉淀成可复用、可校验的知识**。

[《无名杀》](https://github.com/libnoname/noname) 是一个开源的三国杀-like 卡牌游戏，本体 + 扩展共有约 7200 个技能、12 MB 技能源码。为它写武将技能时，最大的困难不是语法，而是**不知道某个效果别人是怎么写的**。

这个仓库提供一个可移植的 DSH Skill + 零依赖 CLI 工具集，解决三件事：

| 问题 | 解法 |
|------|------|
| **找不到参考实现** | 语义检索 7200+ 技能，支持中文长句与英文字段名 |
| **重复踩同一个坑** | 增量知识库，每条结论带**源码指纹**，源码变了自动失效 |
| **写了扩展但游戏里看不到** | 扩展注册诊断与修复 |

---

## 特性

- **零依赖** —— 只用 Node.js 内置模块，Node ≥ 18 即可
- **可移植** —— 约 124 KB，拷到任何《无名杀》仓库都能用
- **自定位** —— 脚本动态解析项目根，不含任何硬编码路径
- **不会误导** —— 知识库条目绑定源码指纹，源码变动即标记失效并跳过
- **自带迁移自检** —— 一条命令扫描硬编码路径、外部依赖、位置假设

---

## 安装

### 方式一：直接放进项目（推荐）

```bash
git clone <本仓库> /tmp/nge
mkdir -p <无名杀项目>/.dsh/skills/noname-general-extension
cp -r /tmp/nge/SKILL.md /tmp/nge/scripts <无名杀项目>/.dsh/skills/noname-general-extension/

cd <无名杀项目>/.dsh/skills/noname-general-extension/scripts
node build-index.mjs          # 构建索引（10–30 秒）
node skill-search.mjs stats   # 验证
```

DSH 会自动发现该 Skill（名称 `noname-general-extension`）。

### 方式二：作为独立工具使用（不放进项目）

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
node skill-search.mjs show drlt_jieying           # 看实现（带行号源码）
node skill-search.mjs similar rb_jiying           # 找结构类似的

# ═══ 沉淀结论 ═══
node skill-search.mjs learn \
  --title "限定技必须调用 awakenSkill" \
  --body  "仅设 limited:true 不够，需在 content 中 await player.awakenSkill(id)" \
  --kind pitfall --from zga_luanming

# ═══ 知识库管理 ═══
node skill-search.mjs kb list      # 全部条目（含失效状态）
node skill-search.mjs kb check     # 只看失效的
node skill-search.mjs kb stats

# ═══ 源码变更后重建索引 ═══
node skill-search.mjs rebuild
```

### 命令一览

| 命令 | 作用 |
|------|------|
| `search <语义>` | 语义检索（先查知识库，再查索引） |
| `show <技能ID>` | 查看技能元信息 + 带行号完整源码 |
| `similar <技能ID>` | 找结构相似的技能 |
| `learn` | 沉淀一条结论到知识库 |
| `kb {list,check,show,forget,stats}` | 知识库管理 |
| `stats` / `rebuild` | 索引统计 / 重建 |
| `register-extension.mjs` | 扩展注册诊断与修复 |
| `migrate-skill.mjs` | 打包迁移与可移植性自检 |

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
.
├── SKILL.md                    # 技能主体（Agent 读取的指令）
├── README.md                   # 本文件
└── scripts/
    ├── README.md               # 工具详解
    ├── skill-search.mjs        # 检索引擎 + CLI
    ├── build-index.mjs         # 索引构建器
    ├── knowledge.mjs           # 知识库模块（指纹计算/校验）
    ├── register-extension.mjs  # 扩展注册与修复
    ├── migrate-skill.mjs       # 迁移打包与自检
    └── knowledge-base.json     # 知识沉淀（应入库）
```

索引产物 `skill-index.json`（约 5.6 MB）为生成物，已在 `.gitignore` 中排除。

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

当前解析结果：**7209 个技能，6112 个含描述（84.8%）**。

---

## 许可

工具与文档以 MIT 许可发布。

《无名杀》本体为 GPL-3.0，本仓库不包含其源码。
