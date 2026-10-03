---
name: noname-general-extension
description: 开发《无名杀》武将扩展、编写武将技能，或在已有技能中查找参考实现。当用户要求新增/修改武将、编写技能（触发技、锁定技、主动技、视为技、限定技、觉醒技、转换技）、创建扩展目录、定义 character/skill/translate、检索类似技能实现、沉淀开发结论、或调试"技能不触发/没效果"时使用。内含增量知识库（带源码指纹校验）、技能检索引擎（7206 个技能）、扩展骨架、11 类技能模板、API 速查与避坑清单。
---

# 开发《无名杀》武将扩展

⚠️ **动手前必读**：本 skill 中的每条约定都来自源码实证。**不要凭三国杀桌游常识或旧版无名杀经验编写**——新版引擎已废弃多个旧写法（见"过时写法"）。

## 0. 项目定位

**工作目录 = 《无名杀》源码仓库根**（即包含 `apps/core/noname` 的目录，本 skill 所在仓库）。

> 脚本用 `process.cwd()` 自动向上查找仓库根，因此无需关心绝对路径。

- 源码核心：`apps/core/noname/`
- 扩展目录：`apps/core/extension/<扩展名>/`
- 武将包目录：`apps/core/character/<包名>/`
- 事件系统文档：`docs/YRD/`（自顶向下 18 篇，含源码行号）
- **模板库：`docs/YRD/templates/`（本 skill 的配套资产）**
- **技能检索工具：`scripts/`（在 7206 个已有技能中找参考实现）**

## 1. 标准工作流

> **核心原则：先查知识库，再检索参考实现，最后从模板改写。不要从零编写技能。**

1. **明确需求**：技能的语义是什么？（何时触发、做什么、有无代价）
2. **🔍 检索**（**必做第一步**）：

   ```bash
   cd .dsh/skills/noname-general-extension/scripts
   node skill-search.mjs search "<用功能语义描述，别用技能名>"
   ```

   检索会**自动先查知识库**（📘 区块，带指纹校验）再查技能索引（🔍 区块）：
   - 知识库命中 → 直接采用已沉淀的结论，**无需重复检索**
   - 知识库失效 → 显示警告并自动回退到索引检索
   - 从候选里挑 1-2 个最接近的，`node skill-search.mjs show <技能ID>` 查看实现
   - 不够贴合时：`node skill-search.mjs similar <技能ID>` 找结构类似的

3. **📘 沉淀结论**（开发完成后必做）：

   ```bash
   node skill-search.mjs learn \
     --title "简短标题" \
     --body "结论内容" \
     --kind pattern \
     --keywords "关键词1,关键词2" \
     --from <参考的技能ID>
   ```

   - `--from` 会记录**证据指纹**，源码变动时该知识自动标记失效，不会误导后续开发
   - **每次开发都应该沉淀至少 1 条**，让知识库持续增值

4. **查模板**：从 `docs/YRD/templates/templates/` 选最接近的模板（11 类）。
5. **查文档**：机制不清楚时读 `docs/YRD/` 对应篇章（带源码行号可跳转核对）。
6. **写代码**：结合「知识库/参考实现」与「模板」改写 `character/skill.js`，同步补 `translate.js`。
7. **🔧 注册扩展**（**写完必做，否则游戏里看不到**）：

   ```bash
   cd .dsh/skills/noname-general-extension/scripts
   node register-extension.mjs fix                  # 先修复被游戏内「制作扩展」覆盖的文件
   node register-extension.mjs guideall --enable    # 批量登记 + 启用
   ```

   把输出的脚本粘贴到**浏览器 Console**（F12），然后 F5 刷新。

8. **验证**：游戏内启用扩展 → 选将 → 实际发动技能。

### ★ 修改已有技能（不同于新建）

用户说「改一下 XX」时，**不要凭印象找文件**。一条命令拿到全部定位信息：

```bash
node skill-search.mjs locate <技能ID或中文名>
```

输出包含改一个技能所需的全部坐标：

| 区块 | 用途 |
|------|------|
| ① 技能实现 | `文件:起始行-结束行` —— 改逻辑 |
| ② 技能描述 | 描述原文 + `文件:行号` —— 改文案（**在 translate.js 或 extension.js，不在 skill.js**） |
| ③ 所属武将 | 哪些武将引用此技能、各自体力、定义位置 —— 评估影响面 |
| ④ 结构特征 | 触发时机、关键 API、子技能 —— 判断改动风险 |
| ⑤ 同包技能 | 同包其余技能 —— 找参照写法 |

**三条硬性纪律**：

1. **改描述 ≠ 改实现**。描述文本在 `translate.js` 的 `<id>_info` 字段（本体）或
   `extension.js` 的同一位置（单文件扩展）。`locate` 会直接给出描述所在行号。
2. **中文名可能重名**。如「天妒」有 4 个（`tiandu` / `sbtiandu` / `nagisa_tiandu` / `yxsre_tiandu`）。
   `locate` 遇到重名会**列出全部候选让你选**，绝不替你猜 —— 猜错会改错文件。
3. **改完要重建索引**：`node skill-search.mjs rebuild`，否则下次 `locate` 的行号是旧的。

改完实现后，**同步检查描述是否需要更新**（描述与实现不一致是常见缺陷来源）。

### ⚠️ 两个必知的机制陷阱

**陷阱一：写了扩展目录 ≠ 游戏里能看到**

扩展必须被登记到配置的 `extensions` 数组才显示（`init/index.ts:635-661`）。而玩家配置存于 **浏览器 `localStorage["noname_0.9_config"]`**，服务端改不了。

解决办法（`register-extension.mjs guideall`）：
- 生成一段 Console 脚本，直接写 `localStorage`
- 脚本**顺带开启「自动导入扩展」**——之后新增扩展会被自动发现，**只需做一次**

**陷阱二：游戏内「制作扩展」会覆盖手写文件**

该功能（选项→扩展→制作扩展）会**无提示覆盖**同名扩展的 `extension.js`、`info.json`、`README.md`，生成空白模板。

| 症状 | 扩展能打开，但选将界面找不到武将包 |
| 原因 | 模板的 `precontent` 是空函数，不会 `import` 武将包 |
| 数据 | ✅ `character/` 目录**不会被删除**，武将数据仍完好 |
| 修复 | `node register-extension.mjs fix`（自动重建 extension.js） |

> **新建扩展请手动复制目录结构**（参考 `apps/core/extension/英雄杀/`），不要用游戏内的「制作扩展」。

### 检索与知识库示例

```bash
# 检索（自动先查知识库）
node skill-search.mjs search "摸牌阶段多摸一张牌"
node skill-search.mjs search "viewAs 将一张牌当杀使用"
node skill-search.mjs search "判定 红色黑色"        # 会命中已沉淀的判定写法

# ★ 修改已有技能：一站式定位
node skill-search.mjs locate 天妒                  # 也支持中文名（同名会列出候选）
node skill-search.mjs locate yxsre_fenglang

# 查看实现
node skill-search.mjs show drlt_jieying
node skill-search.mjs similar biyue

# 沉淀结论（开发后）
node skill-search.mjs learn \
  --title "令角色放弃摸牌用 changeToZero" \
  --body "trigger.changeToZero() 令 num=0 且 numFixed=true" \
  --kind pattern --keywords "放弃摸牌,changeToZero" --from <技能ID>

# 知识库管理
node skill-search.mjs kb list      # 全部条目（含失效状态）
node skill-search.mjs kb check     # 只看失效的
node skill-search.mjs kb stats     # 统计
node skill-search.mjs kb forget <id>   # 移除

# 扩展注册（写完扩展后必做）
node register-extension.mjs status       # 检查注册状态
node register-extension.mjs fix          # 修复被覆盖的 extension.js
node register-extension.mjs guideall --enable   # 批量登记 + 启用

# 迁移到其他机器（换电脑/换仓库时）
node migrate-skill.mjs pack               # 打包（约 120 KB，不含索引）
node migrate-skill.mjs check              # 迁移后自检
node build-index.mjs                      # 新机器上重建索引
```

> ⚠️ 索引需在源码变更后重建：`node skill-search.mjs rebuild`
> 详见 `scripts/README.md`。
>
> **迁移到其他机器**：只拷 6 个脚本 + `knowledge-base.json` + `SKILL.md`（约 120 KB），
> **不要拷 `skill-index.json`**（里面硬编码了原机器路径），到新机器后跑一次 `build-index.mjs` 即可。

### 启动开发环境

```bash
# 两个服务需同时运行
pnpm -F noname dev                                          # Vite 8080
pnpm -F @noname/fs dev --debug --dirname=../../apps/core    # 文件服务 8089
```

访问 `http://127.0.0.1:8080/`

> 首次安装依赖需联网：`pnpm install`。若 `@esbuild/win32-x64` 缺失导致启动失败，在 `apps/core` 下重新 `pnpm install`。

## 2. 扩展目录结构

```
apps/core/extension/我的扩展/
├── extension.js          ★ 必需：必须 export type 与 default
├── info.json             ★ 必需
├── main/
│   ├── precontent.js     ★ 必需：import 武将包
│   └── content.js        可选：rank/config 后处理
├── character/
│   ├── index.js          ★ game.import("character", fn)
│   ├── character.js      武将定义
│   ├── skill.js          技能定义
│   ├── translate.js      翻译（武将名/技能名/技能描述）
│   ├── intro.js          可选
│   ├── sort.js           可选：分组排序
│   ├── characterFilter.js 可选
│   ├── dynamicTranslate.js 可选
│   └── voices.js / pinyin.js  可选
├── image/character/<武将ID>.jpg     立绘
└── audio/skill/<技能ID>.mp3         配音
```

**完整模板见** `docs/YRD/templates/`（02~09 号文件可直接复制）。

## 3. 三个硬性约定

### ① extension.js 必须导出两个东西

```js
export let type = "extension";     // 引擎校验类型
export default extensionPackage;   // 扩展主体
```

依据：`apps/core/noname/init/import.ts:72-77`

### ② precontent 是引入武将包的唯一时机

```js
// main/precontent.js
import "../character/index.js";                       // 触发 game.import
export function precontent(config, pack) {
    lib.translate.我的扩展_character_config = "我的扩展";
}
```

### ③ 武将包入口格式

```js
game.import("character", function () {
    return {
        name: "mypack",        // ⚠️ 扩展内此值会被强制覆盖为扩展文件夹名
        character: { ... },
        skill: { ... },
        translate: { ... },
    };
});
```

⚠️ **`name` 覆盖陷阱**：`apps/core/noname/init/loading.ts:269` 会执行 `content.name = extension[0]`，所以扩展内武将包的 `name` **永远等于扩展文件夹名**，写什么都无效。因此 `characterSort` 的内层键应与扩展目录名一致。

> 独立武将包（`apps/core/character/` 下）不受影响。

## 4. 技能骨架（背下来）

```js
mypack_skillid: {
    // ① 何时触发（必须是对象，四个作用域：player/source/target/global）
    trigger: { player: "phaseJieshuBegin" },

    // ② 条件判定 —— 纯判定，禁止副作用，会被反复调用
    //    签名：filter(event, player, triggername, indexedData)
    filter(event, player) {
        return true;
    },

    // ③ 是否发动（可选）—— 必须写 event.result = await ....forResult()
    async cost(event, trigger, player) {
        event.result = await player.chooseTarget(/* ... */).forResult();
    },

    // ④ 效果
    async content(event, trigger, player) {
        await player.draw();
    },
},
```

### 三个形参的含义（**最易错**）

| 形参 | 实际是 |
|------|--------|
| `event` | 技能效果事件（`event.name` = 技能 ID） |
| `trigger` | **触发源事件**（如 `phaseJieshu` 事件） |
| `player` | 技能拥有者 |

⚠️ `trigger` 只在 `filter`/`cost`/`content` 内有效。**`await` 之后必须用形参 `trigger`**，不能依赖全局 `trigger`。

### filter vs cost

| | `filter(event, player, triggername, indexedData)` | `cost(event, trigger, player)` |
|---|---|---|
| 作用 | 纯判定，能不能发动 | 执行代价 + 写 `event.result` |
| 调用 | **反复调用**（可能几十次） | 仅一次 |
| 副作用 | **禁止** | 允许 |

依据：`apps/core/noname/library/index.js:11025`

## 5. 武将（Character）字段

权威定义：`apps/core/noname/library/element/character.js:2-182`

### 常用字段

```js
mypack_guanyu: {
    sex: "male",              // "male"|"female"|"double"|""
    group: "shu",             // 合法值：wei/shu/wu/qun/jin/shen
    hp: 4,                    // 也可字符串 "4/6" 或 "4/6/1"(hp/maxHp/hujia)
    maxHp: 4,                 // ⚠️ 对象格式下非 number 会回落到 hp（character.js:202-204）
    hujia: 0,
    skills: ["mypack_wusheng"],
    names: "关|羽",            // 「姓|名」竖排；"null|null" 表示不显示
    img: "extension/我的扩展/image/character/mypack_guanyu.jpg",
    isBoss: false,            // BOSS
    doubleGroup: ["shu", "wu"], // 多势力（国战）
},
```

### ⚠️ 不存在的字段（别写）

| 误写 | 实际 |
|------|------|
| `hiddenSkills` | 不是武将字段，是 **Player 实例属性**（`player.js:109`）。武将侧用 `hasHiddenSkill: true` |
| `growthHp` | **全仓库零命中**，无效字段 |
| `tags` | 不存在。标签走数组格式的 `trashBin`（`character.js:249-308`） |

### 立绘路径（两种布局并存）

- **自动推导**（`loading.ts:304`，仅在未写 `img` 时）：`extension/<扩展名>/<武将ID>.jpg` —— 指向**扩展根目录**
- **官方扩展实际用法**（`英雄杀/character.js:290`）：`extension/英雄杀/image/character/<武将ID>.jpg`

⚠️ 两者不一致。**建议显式写 `img` 或循环赋值**，不要依赖隐式约定。

### 翻译表

```js
mypack_guanyu: "关羽",                    // 武将名
mypack_wusheng: "武圣",                   // 技能名（⚠️ 不要带【】，引擎自动加）
mypack_wusheng_info: "将一张红色牌当【杀】使用。",  // 技能描述
```

描述可用：`<br>` 换行、`<li>` 列表、`${get.poptip("技能ID")}` 嵌入提示、`<span class='firetext'>` 着色。
⚠️ `#g/#r/#b/#p` 颜色前缀**只对武将称号生效**，技能描述里无效。

## 6. 11 类技能模板索引

**写技能第一步：从下表选模板，不要从零开始。**

| 需求 | 模板文件 |
|------|---------|
| 满足条件时触发 | `templates/01-被动触发技.js` |
| 强制发动不询问 | `templates/02-锁定技.js` |
| 发动需弃牌/选目标 | `templates/03-有代价的触发技.js` |
| 将 X 当 Y 使用 | `templates/04-视为技viewAs.js` |
| 出牌阶段主动发动 | `templates/05-主动技.js` |
| 一局仅一次 / 觉醒 | `templates/06-限定技与觉醒技.js` |
| 转换技、记录状态 | `templates/07-状态切换技.js` |
| 摸牌/伤害/回复 | `templates/08-直接效果技.js` |
| 选多个目标 | `templates/09-多目标技.js` |
| 技能由多部分协作 | `templates/10-附属技能.js` |
| 限时生效的子技能 | `templates/11-临时技能.js` |

路径前缀：`docs/YRD/templates/templates/`

## 7. API 速查

### 效果类（均可 await）

```js
await player.draw(n)                          // 摸牌
await player.draw({ nodelay: true })          // 摸牌跳过动画
await player.recover(n)                       // 回复体力
await player.loseHp(n)                        // 失去体力（不触发伤害事件）
await player.damage(n)                        // 造成伤害
await player.damage({ nature, source, card }) // 带属性伤害
await player.discard({ cards, discarder })    // 弃牌
await player.gain({ cards, animate })         // 获得牌
await player.gainPlayerCard(target, pos, bool)
await player.discardPlayerCard(target, pos, bool)
await player.gainMaxHp() / loseMaxHp()
player.awakenSkill(skillId)                   // 标记限定技已用
```

### 询问类（**必须 `.forResult()`**）

| API | 返回 |
|-----|------|
| `chooseToDiscard` / `chooseCard` | `{ bool, cards }` |
| `chooseTarget` | `{ bool, targets }` |
| `chooseBool` | `{ bool }` |
| `chooseToUse` | `{ bool, card, cards, targets }` |
| `chooseControl` | `{ bool, control }` |
| `chooseButton` | `{ bool, links }` |

### 状态与管理

```js
player.storage.<skillId>              // 内部状态（不显示）
player.markAuto(skill, [values])      // 可见标记
player.addTempSkill(id, expireTiming) // 临时技能
player.addSkills([...])               // 永久获得
player.removeSkill(id)
player.hasSkill(id)
```

## 8. 十一大避坑（按危害排序）

1. **`cost` 忘记 `event.result = ...`** → 技能永不发动，**且无任何报错**（最难查）
2. **忘记 `.forResult()`** → 拿到事件对象而非结果，`bool` 判定异常
3. **限定技忘记 `player.awakenSkill(event.name)`** → 可无限发动
4. **在 `filter` 里产生副作用** → 会被执行几十次，状态错乱
5. **临时技能 ID 未定义** → `addTempSkill` **静默失败**，无报错
6. **多目标时用 `event.target`** → 它是 `undefined`，必须用 `event.targets`
7. **AI 回调里直接用 `player` 变量** → 不可用，需 `get.player()` / `get.event().player`
8. **`subSkill` 子技能忘记 `charlotte: true`** → 显示在武将牌上
9. **`group` 引用的技能不存在** → 静默失效，无报错
10. **不 `await` 效果事件** → 后续逻辑提前执行，产生竞态
11. **写了不存在的武将字段**（`hiddenSkills`/`growthHp`/`tags`）→ 静默无效

## 9. 过时写法（**新代码不要用**）

| 过时 | 现应使用 | 说明 |
|------|---------|------|
| `direct: true` | `cost` | 老包仍在用（如 `sp/skill.js` 的 `olfeiyang`），新包已统一改 `cost` |
| `"step 0"; ... "step 1";` | `async content` + `await` | 旧式语法，仅 8 个未重构包残留 876 处 |
| 全局 `trigger` 变量 | `content(event, trigger, player)` 形参 | `await` 后全局变量已失效 |

### 新旧对比

```js
// ❌ 旧式
content() {
    "step 0";
    player.chooseToDiscard(2).set("ai", card => 1);
    "step 1";
    if (result.bool) { player.draw(); }
}

// ✅ 新式
async content(event, trigger, player) {
    const result = await player.chooseToDiscard(2)
        .set("ai", card => 1)
        .forResult();
    if (result.bool) {
        await player.draw();
    }
}
```

## 10. 调试方法

```
技能不触发？
├─ trigger 作用域是否写对（player/source/target/global）
├─ 时机名拼写（事件名 + 后缀）
├─ filter 是否返回 false
└─ lib.hookmap[时机名] 是否为 true

技能触发了但不发动？
├─ cost 是否写了 event.result
├─ chooseBool 玩家/AI 是否选了否
└─ check 函数是否正确

技能发动了但没效果？
├─ console.error 是否有报错（联机非 debug 时错误被吞！）
├─ content 是否真的执行（事件名 = 技能名）
└─ 是否 await 了异步操作
```

常用调试代码：

```js
_status.eventManager.eventStack.map(e => e.name)   // 当前事件栈
lib.hookmap["phaseJieshuBegin"]                    // 时机是否被注册
lib.hook["1_player_phaseJieshuBegin"]              // 谁注册了
player.tempSkills                                  // 临时技能
player.getStat("triggerSkill")                     // 发动次数
```

## 11. 深入学习路径

| 需求 | 文档 |
|------|------|
| **检索参考实现** | `scripts/README.md`（工具详解与检索技巧） |
| 系统理解事件系统 | `docs/YRD/README.md`（自顶向下 18 篇） |
| 触发机制原理 | `docs/YRD/08-trigger-system.md` |
| 技能执行链路 | `docs/YRD/09-skill-execution.md` |
| 易错点全清单 | `docs/YRD/appendix-c-pitfalls.md` |
| 源码行号地图 | `docs/YRD/appendix-a-source-map.md` |
| 术语速查 | `docs/YRD/appendix-b-glossary.md` |
| 武将字段/翻译规范 | `docs/YRD/templates/README.md` |

**参考实现**（真实生产代码，值得对照）：

- `apps/core/character/standard/skill.js` — 已重构的现代写法样板
- `apps/core/extension/英雄杀/` — 完整扩展范例（含 info.json/precontent/content）
- `apps/core/extension/3D精选/character/index.js` — 武将包入口范例
