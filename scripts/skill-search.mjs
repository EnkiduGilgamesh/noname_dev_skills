#!/usr/bin/env node
/**
 * 无名杀技能检索工具
 *
 * 两阶段检索（对应"先看值不值得参考，再决定是否深入"）：
 *   阶段 1  search  —— 按语义搜技能描述，返回候选清单（轻量）
 *   阶段 2  show    —— 查看指定技能的完整实现源码
 *
 * 用法：
 *   node skill-search.mjs search "摸牌阶段多摸一张"          # 语义搜索
 *   node skill-search.mjs search "受到伤害后摸牌" --impl     # 只看有实现特征的
 *   node skill-search.mjs show biyue                        # 查看实现
 *   node skill-search.mjs similar biyue                     # 找同类技能
 *   node skill-search.mjs stats                             # 索引统计
 *   node skill-search.mjs rebuild                           # 重建索引
 *
 * 选项：
 *   --limit N      返回条数（默认 12）
 *   --source X     character | extension | core | all（默认 all）
 *   --impl         仅返回包含 content 实现的技能
 *   --json         输出 JSON
 */
import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { KnowledgeBase, makeFingerprint, verifyFingerprint, hashText } from "./knowledge.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const INDEX_PATH = join(HERE, "skill-index.json");
const KB_PATH = join(HERE, "knowledge-base.json");

// ── 参数解析 ───────────────────────────────────────────────
const argv = process.argv.slice(2);
const cmd = argv[0] || "help";
function opt(name, dflt) {
    const i = argv.indexOf(name);
    return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : dflt;
}
function flag(name) {
    return argv.includes(name);
}

// ── 索引加载 ───────────────────────────────────────────────
if (!existsSync(INDEX_PATH)) {
    console.error(`索引不存在: ${INDEX_PATH}`);
    console.error(`请先运行: node build-index.mjs`);
    process.exit(1);
}
const INDEX = JSON.parse(readFileSync(INDEX_PATH, "utf8"));
const SKILLS = INDEX.skills;

/**
 * 项目根解析 —— 必须【动态计算】，不能用索引里记录的 INDEX.root。
 *
 * 原因：skill-index.json 可能从别的机器复制过来，其中的 root 是旧机器的绝对路径。
 * 若直接沿用，show/kb 等需要读源文件的命令会指向不存在的路径。
 *
 * 解析顺序：
 *   ① --root 参数
 *   ② 从 cwd 向上查找含 apps/core/noname 的目录
 *   ③ 从本脚本位置向上查找（skill 位于 <项目根>/.dsh/skills/ 下）
 *   ④ 兜底：索引中记录的 root（并给出警告）
 */
function findProjectRoot(start) {
    let cur = resolve(start);
    for (let i = 0; i < 10; i++) {
        if (existsSync(join(cur, "apps/core/noname"))) {
            return cur;
        }
        const up = dirname(cur);
        if (up === cur) {
            break;
        }
        cur = up;
    }
    return null;
}

const ROOT = (() => {
    const explicit = opt("--root", null);
    if (explicit) {
        return resolve(explicit);
    }
    const fromCwd = findProjectRoot(process.cwd());
    if (fromCwd) {
        return fromCwd;
    }
    const fromHere = findProjectRoot(HERE);
    if (fromHere) {
        return fromHere;
    }
    // 兜底：用索引里的 root（可能已失效）
    if (INDEX.root && existsSync(INDEX.root)) {
        return INDEX.root;
    }
    console.error("⚠ 无法定位项目根（需包含 apps/core/noname）");
    console.error("  请用 --root <路径> 指定，或在项目目录内运行");
    console.error(`  索引中记录的 root: ${INDEX.root || "(无)"}`);
    process.exit(1);
})();

// 若与索引中的 root 不同，提示用户索引可能已过期
if (INDEX.root && resolve(INDEX.root) !== ROOT) {
    console.error(`⚠ 索引是用不同的项目根生成的，建议重建索引：`);
    console.error(`    索引 root: ${INDEX.root}`);
    console.error(`    当前 root: ${ROOT}`);
    console.error(`    运行: node skill-search.mjs rebuild`);
    console.error("");
}

// ── 知识库加载 ─────────────────────────────────────────────
const KB = new KnowledgeBase(KB_PATH, ROOT);

// ── 语义匹配 ───────────────────────────────────────────────
// 无外部依赖：中文按字/词切分，英文按词切分，配合语义词典扩展同义词

const SYNONYMS = {
    摸牌: ["draw", "摸", "抓牌"],
    弃牌: ["discard", "弃置", "丢掉"],
    伤害: ["damage", "受伤", "造成伤害"],
    回复: ["recover", "回血", "恢复"],
    体力: ["hp", "血"],
    判定: ["judge", "判定牌"],
    出牌阶段: ["phaseUse", "出牌"],
    摸牌阶段: ["phaseDraw"],
    弃牌阶段: ["phaseDiscard"],
    结束阶段: ["phaseJieshu"],
    准备阶段: ["phaseZhunbei"],
    回合开始: ["phaseBegin"],
    回合结束: ["phaseEnd"],
    濒死: ["dying"],
    死亡: ["die"],
    锁定技: ["forced"],
    限定技: ["limited"],
    觉醒技: ["juexingji"],
    视为: ["viewAs"],
    主动技: ["enable"],
    转换技: ["zhuanhuanji"],
    多摸: ["draw"],
    少摸: ["draw"],
    获得: ["gain"],
    失去: ["lose"],
    翻面: ["turnOver"],
    上限: ["maxHp", "hujia"],
};

/** 把查询串切成 token */
function tokenize(q) {
    const tokens = new Set();
    // 英文/数字
    for (const w of q.toLowerCase().match(/[a-z][a-z0-9_]*/g) || []) tokens.add(w);
    // 中文：2-4 字的滑动窗口 + 单字
    const cn = q.match(/[\u4e00-\u9fa5]+/g) || [];
    for (const seg of cn) {
        for (let n = 4; n >= 2; n--) {
            for (let i = 0; i + n <= seg.length; i++) tokens.add(seg.slice(i, i + n));
        }
        for (const ch of seg) tokens.add(ch);
    }
    // 展开同义词
    for (const t of [...tokens]) {
        for (const [key, syns] of Object.entries(SYNONYMS)) {
            if (t === key || key.includes(t) || t.includes(key)) {
                for (const s of syns) tokens.add(s.toLowerCase());
            }
        }
    }
    return [...tokens];
}

/** 把技能的结构化特征也转成可搜索文本 */
function featureText(skill) {
    const parts = [];
    if (skill.hasViewAs) parts.push("viewAs 视为 转化 当作 使用");
    if (skill.hasMod) parts.push("mod 修正 距离 上限 次数");
    if (skill.hasCost) parts.push("cost 代价");
    if (skill.hasEnable) parts.push("enable 主动 useSkill phaseUse");
    if (skill.hasFilter) parts.push("filter 条件");
    if (skill.hasContent) parts.push("content 效果");
    if (skill.hasGroup) parts.push("group 技能组");
    if (skill.hasSubSkill) parts.push("subSkill 子技能");
    if (skill.forced) parts.push("forced 锁定技 强制");
    if (skill.limited) parts.push("limited 限定技");
    if (skill.juexingji) parts.push("juexingji 觉醒技");
    if (skill.direct) parts.push("direct");
    if (skill.silent) parts.push("silent 静默");
    if (skill.apis?.length) parts.push(skill.apis.join(" "));
    return parts.join(" ");
}

/** 对一个技能打分 */
function score(skill, tokens, rawQuery) {
    if (!skill.desc && !skill.name) return 0;
    const descLower = (skill.desc || "").toLowerCase();
    const nameLower = (skill.name || "").toLowerCase();
    const idLower = skill.id.toLowerCase();
    const featLower = featureText(skill).toLowerCase();

    let total = 0;
    for (const t of tokens) {
        const tl = t.toLowerCase();
        if (!tl) continue;
        const w = tl.length >= 3 ? 3 : tl.length === 2 ? 2 : 1;
        if (descLower.includes(tl)) total += w * 2;
        if (nameLower.includes(tl)) total += w * 4;
        if (idLower.includes(tl)) total += w * 3;
        if (featLower.includes(tl)) total += w * 3;   // ← 特征也参与匹配
        for (const trg of skill.triggers || []) {
            if (trg.toLowerCase().includes(tl)) total += w * 3;
        }
    }
    // 完整短语命中加成
    if (rawQuery.length >= 4 && descLower.includes(rawQuery.toLowerCase())) total += 30;
    // 有实现的价值更高（可参考性）
    if (skill.hasContent) total += 2;
    if (skill.hasViewAs) total += 2;
    if (skill.hasMod) total += 1;
    return total;
}

// ── 输出格式化 ─────────────────────────────────────────────

function sourceTag(s) {
    if (s.source === "extension") return `扩展/${s.pack}`;
    if (s.source === "character") return `武将包/${s.pack}`;
    if (s.source === "core") return `本体`;
    return "其他";
}

/** 描述截断 */
function clip(str, n) {
    if (!str) return "";
    return str.length > n ? str.slice(0, n - 1) + "…" : str;
}

/** 特征摘要 */
function featureSummary(s) {
    const f = [];
    if (s.forced) f.push("锁定技");
    if (s.limited) f.push("限定技");
    if (s.juexingji) f.push("觉醒技");
    if (s.hasViewAs) f.push("viewAs");
    if (s.hasMod) f.push("mod");
    if (s.hasCost) f.push("cost");
    if (s.hasEnable) f.push("主动");
    if (s.triggers?.length) {
        const t = s.triggers.slice(0, 3).map(x => x.split(":")[1]).join(",");
        f.push(`触发:${t}`);
    }
    return f.join(" ");
}

// ── 命令实现 ───────────────────────────────────────────────

function cmdSearch() {
    const query = argv[1];
    if (!query || query.startsWith("--")) {
        console.error("用法: node skill-search.mjs search \"<语义描述>\" [--limit N] [--source X] [--impl]");
        process.exit(1);
    }
    const limit = parseInt(opt("--limit", "12"), 10);
    const source = opt("--source", "all");
    const onlyImpl = flag("--impl");
    const noKB = flag("--no-kb");

    // ═══ 阶段 0：先查知识库（校验指纹）═══
    let kbFresh = [];
    let kbStale = [];
    if (!noKB) {
        const hits = KB.match(query, 5);
        kbFresh = hits.filter(h => h.status === "fresh");
        kbStale = hits.filter(h => h.status !== "fresh");
    }

    // ═══ 阶段 1：索引检索（始终执行，保证结果完整）═══
    const tokens = tokenize(query);
    let pool = SKILLS;
    if (source !== "all") pool = pool.filter(s => s.source === source);
    if (onlyImpl) pool = pool.filter(s => s.hasContent || s.hasViewAs || s.hasMod);

    const scored = pool
        .map(s => ({ s, v: score(s, tokens, query) }))
        .filter(x => x.v > 0)
        .sort((a, b) => b.v - a.v)
        .slice(0, limit);

    if (flag("--json")) {
        console.log(JSON.stringify({
            knowledge: kbFresh.map(h => ({ id: h.id, title: h.title, kind: h.kind, body: h.body, refs: h.refs })),
            staleKnowledge: kbStale.map(h => ({ id: h.id, title: h.title, status: h.status })),
            skills: scored.map(x => ({ ...x.s, score: x.v })),
        }, null, 2));
        return;
    }

    console.log(`\n查询: "${query}"`);

    // ── 知识库结果 ──
    if (kbFresh.length) {
        console.log(`\n📘 知识库命中 ${kbFresh.length} 条（指纹校验通过）`);
        console.log("═".repeat(100));
        for (const h of kbFresh) {
            const kindLabel = { pattern: "写法", pitfall: "坑点", recipe: "配方", fact: "事实" }[h.kind] || h.kind;
            console.log(`【${h.title}】 (${kindLabel} · 置信度 ${h.confidence})`);
            console.log(`  ${h.body.replace(/\n/g, "\n  ")}`);
            if (h.refs?.length) console.log(`  📎 ${h.refs.join("  ")}`);
            console.log("");
        }
    }
    if (kbStale.length) {
        console.log(`\n⚠️  知识库有 ${kbStale.length} 条相关知识已失效（源码已变动），已跳过：`);
        for (const s of kbStale) {
            console.log(`   · 【${s.title}】 ${s.status === "missing" ? "文件已不存在" : "内容已变化"}`);
        }
        console.log(`   处理：node skill-search.mjs kb check   （查看详情）`);
        console.log(`         node skill-search.mjs kb forget <id>  （移除失效条目）`);
    }

    // ── 索引结果 ──
    console.log(`\n🔍 技能索引命中 ${scored.length} 条`);
    console.log("─".repeat(100));

    for (const { s, v } of scored) {
        console.log(`【${s.name || s.id}】  ${s.id}   [${sourceTag(s)}]  匹配度 ${v}`);
        if (s.desc) console.log(`  描述: ${clip(s.desc, 130)}`);
        const feat = featureSummary(s);
        if (feat) console.log(`  特征: ${feat}`);
        console.log(`  位置: ${s.file}:${s.line}-${s.endLine}`);
        console.log("");
    }

    if (scored.length === 0 && kbFresh.length === 0) {
        console.log("未命中。建议：\n  · 换用更通用的关键词（如「摸牌」「伤害」而非整句）\n  · 加 --source extension 限定扩展\n  · 或直接 node skill-search.mjs stats 查看索引概况");
    } else {
        console.log("─".repeat(100));
        console.log(`深入查看实现: node skill-search.mjs show <技能ID>`);
        console.log(`找同类技能:   node skill-search.mjs similar <技能ID>`);
        console.log(`沉淀结论:     node skill-search.mjs learn --from <技能ID> --title "..." --body "..."`);
    }
}

/**
 * 读取源码文件 —— 自动处理非 UTF-8 编码。
 * 部分老扩展（如 英雄杀RE）是 GBK 编码，直接按 UTF-8 读会得到乱码。
 */
function readSource(file) {
    let buf;
    try { buf = readFileSync(file); } catch { return null; }
    try {
        return new TextDecoder("utf-8", { fatal: true }).decode(buf);
    } catch {
        try { return new TextDecoder("gbk").decode(buf); } catch { return buf.toString("utf8"); }
    }
}

function cmdShow() {
    const id = argv[1];
    if (!id) {
        console.error("用法: node skill-search.mjs show <技能ID>");
        process.exit(1);
    }
    const hit = resolveSkill(id);
    if (!hit) process.exit(1);

    const abs = join(ROOT, hit.file);
    if (!existsSync(abs)) {
        console.error(`源文件不存在: ${abs}`);
        process.exit(1);
    }
    const text = readSource(abs);
    const lines = (text || "").split(/\r?\n/);
    const slice = lines.slice(hit.line - 1, hit.endLine);

    console.log(`\n═══ ${hit.name || hit.id} (${hit.id}) ═══`);
    console.log(`来源: ${sourceTag(hit)}`);
    console.log(`位置: ${hit.file}:${hit.line}-${hit.endLine}`);
    if (hit.desc) console.log(`描述: ${hit.desc}`);
    const feat = featureSummary(hit);
    if (feat) console.log(`特征: ${feat}`);
    if (hit.subSkills?.length) console.log(`子技能: ${hit.subSkills.join(", ")}`);
    if (hit.apis?.length) console.log(`关键 API: ${hit.apis.join(", ")}`);
    console.log(`\n─── 实现源码 ───\n`);
    // 带行号输出，便于直接引用
    slice.forEach((l, i) => {
        const n = String(hit.line + i).padStart(6, " ");
        console.log(`${n}| ${l}`);
    });
    console.log("");
}

/** 解析技能 ID：精确优先，其次唯一模糊匹配；多义时列出候选并返回 null */
function resolveSkill(id) {
    let hit = SKILLS.find(s => s.id === id);
    if (hit) return hit;
    const cands = SKILLS.filter(s => s.id.toLowerCase().includes(id.toLowerCase()));
    if (cands.length === 0) {
        console.error(`未找到技能: ${id}`);
        console.error(`提示：先用 search 找到准确的技能 ID`);
        return null;
    }
    if (cands.length > 1) {
        console.log(`"${id}" 匹配到多个技能，请指定完整 ID：\n`);
        for (const c of cands.slice(0, 20)) console.log(`  ${c.id}  (${c.name || "-"})  [${sourceTag(c)}]`);
        return null;
    }
    return cands[0];
}

/**
 * locate —— 「改这个技能」的一站式定位。
 *
 * 用户说「改一下 XX」时，需要一次性拿到：
 *   ① 技能实现位置（改逻辑）
 *   ② 描述文本位置（改文案）
 *   ③ 所属武将（改数值/称号；评估影响面）
 *   ④ 邻近的同类技能（参考实现）
 *
 * 输出的是「可执行的修改清单」，而不是让 agent 再去翻文件。
 */
function cmdLocate() {
    const id = argv[1];
    if (!id) {
        console.error("用法: node skill-search.mjs locate <技能ID或中文名>");
        process.exit(1);
    }

    // 支持用中文名定位（用户通常说「改天妒」而不是 tiandu）
    // 注意：中文名常有多个同名技能（如「天妒」有 4 个），此时必须让用户选，
    //       不能猜 —— 猜错会改错文件，是最浪费时间的失败模式。
    let hit = SKILLS.find(s => s.id === id);
    if (!hit) {
        const byName = SKILLS.filter(s => s.name === id);
        if (byName.length === 1) {
            hit = byName[0];
        } else if (byName.length > 1) {
            console.log(`\n「${id}」有 ${byName.length} 个同名技能，请指定完整 ID：\n`);
            for (const c of byName) {
                console.log(`  ${c.id.padEnd(22)} [${sourceTag(c)}]  ${c.file}:${c.line}`);
                if (c.desc) console.log(`      ${c.desc.slice(0, 58)}`);
            }
            console.log(`\n  提示：用 locate <完整ID> 继续\n`);
            process.exit(0);
        }
    }
    if (!hit) {
        const cands = SKILLS.filter(s =>
            s.id.toLowerCase().includes(id.toLowerCase()) ||
            (s.name && s.name.includes(id))
        );
        if (cands.length === 0) {
            console.error(`未找到技能: ${id}`);
            process.exit(1);
        }
        if (cands.length > 1) {
            console.log(`"${id}" 匹配到 ${cands.length} 个，请指定：\n`);
            for (const c of cands.slice(0, 25)) {
                console.log(`  ${c.id.padEnd(22)} ${(c.name || "-").padEnd(8)} [${sourceTag(c)}]`);
            }
            process.exit(0);
        }
        hit = cands[0];
    }

    console.log(`\n════════════════════════════════════════════════════════════`);
    console.log(`  ${hit.name || ""} (${hit.id})`);
    console.log(`════════════════════════════════════════════════════════════`);
    console.log(`来源: ${sourceTag(hit)}`);

    // ① 实现位置
    const abs = join(ROOT, hit.file);
    console.log(`\n【① 技能实现】← 改逻辑`);
    console.log(`   ${hit.file}:${hit.line}-${hit.endLine}   (${hit.endLine - hit.line + 1} 行)`);
    if (!existsSync(abs)) console.log(`   ⚠ 文件不存在`);

    // ② 描述位置
    console.log(`\n【② 技能描述】← 改文案`);
    if (hit.desc) {
        console.log(`   "${hit.desc}"`);
        if (hit.descFile && hit.descLine) {
            console.log(`   ${hit.descFile}:${hit.descLine}   ← 描述定义处`);
        } else {
            console.log(`   ⚠ 未定位到描述定义处（可能是动态拼接）`);
        }
    } else {
        console.log(`   （无描述）`);
    }

    // ③ 所属武将
    console.log(`\n【③ 所属武将】← 改数值/称号，评估影响面`);
    if (hit.owners?.length) {
        for (const o of hit.owners) {
            console.log(`   ${o.id.padEnd(20)} ${o.hp ? o.hp + " 体力" : ""}   ${o.file}:${o.line}`);
        }
        console.log(`   共 ${hit.owners.length} 个武将引用此技能`);
    } else {
        console.log(`   （无武将直接引用；可能是衍生技/子技能/卡牌技）`);
    }

    // ④ 结构特征与关键 API
    const feat = featureSummary(hit);
    if (feat || hit.apis?.length) {
        console.log(`\n【④ 结构特征】← 判断改动风险`);
        if (feat) console.log(`   ${feat}`);
        if (hit.apis?.length) console.log(`   关键 API: ${hit.apis.join(", ")}`);
        if (hit.subSkills?.length) console.log(`   子技能: ${hit.subSkills.join(", ")}`);
        if (hit.triggers?.length) console.log(`   触发时机: ${hit.triggers.join(", ")}`);
    }

    // ⑤ 同包邻近技能
    const sib = SKILLS.filter(s => s.pack === hit.pack && s.source === hit.source && s.id !== hit.id);
    if (sib.length) {
        console.log(`\n【⑤ 同包技能】← 找参照写法（共 ${sib.length} 个，显示前 8）`);
        for (const s of sib.slice(0, 8)) {
            console.log(`   ${s.id.padEnd(22)} ${s.name || ""}`);
        }
    }

    console.log(`\n【下一步】`);
    console.log(`   看实现:  node skill-search.mjs show ${hit.id}`);
    console.log(`   找参考:  node skill-search.mjs similar ${hit.id}`);
    console.log("");
}

function cmdSimilar() {
    const id = argv[1];
    if (!id) {
        console.error("用法: node skill-search.mjs similar <技能ID>");
        process.exit(1);
    }
    const base = SKILLS.find(s => s.id === id);
    if (!base) {
        console.error(`未找到技能: ${id}`);
        process.exit(1);
    }
    const limit = parseInt(opt("--limit", "10"), 10);

    // 相似度：技能描述 token 重合 + 触发时机重合 + 特征重合
    const baseTokens = new Set(tokenize(base.desc || base.name || base.id));
    const baseTrig = new Set(base.triggers || []);

    const scored = SKILLS
        .filter(s => s.id !== id)
        .map(s => {
            let v = 0;
            const st = tokenize(s.desc || s.name || "");
            for (const t of st) if (baseTokens.has(t)) v += 1;
            for (const t of s.triggers || []) if (baseTrig.has(t)) v += 6;
            if (base.hasViewAs && s.hasViewAs) v += 4;
            if (base.hasMod && s.hasMod) v += 3;
            if (base.forced && s.forced) v += 2;
            if (base.hasCost && s.hasCost) v += 2;
            if (base.pack === s.pack) v += 1;
            return { s, v };
        })
        .filter(x => x.v > 3)
        .sort((a, b) => b.v - a.v)
        .slice(0, limit);

    console.log(`\n与【${base.name || base.id}】相似的技能（${scored.length} 条）`);
    console.log(`基准描述: ${clip(base.desc, 100)}\n`);
    console.log("─".repeat(100));
    for (const { s, v } of scored) {
        console.log(`【${s.name || s.id}】 ${s.id}  [${sourceTag(s)}]  相似度 ${v}`);
        if (s.desc) console.log(`  ${clip(s.desc, 120)}`);
        console.log(`  ${s.file}:${s.line}`);
        console.log("");
    }
}

function cmdStats() {
    console.log(`\n═══ 技能索引统计 ═══`);
    console.log(`构建时间: ${INDEX.builtAt}`);
    console.log(`项目根:   ${INDEX.root}`);
    console.log(`技能总数: ${INDEX.counts.total}`);
    console.log(`含描述:   ${INDEX.counts.withDesc} (${((INDEX.counts.withDesc / INDEX.counts.total) * 100).toFixed(1)}%)`);
    console.log(`\n来源分布:`);
    for (const [k, v] of Object.entries(INDEX.counts.bySource)) {
        const label = k === "character" ? "武将包" : k === "extension" ? "扩展" : k === "core" ? "本体" : k;
        console.log(`  ${label.padEnd(8)} ${v}`);
    }
    // 特征分布
    const f = {
        "有 content 实现": SKILLS.filter(s => s.hasContent).length,
        "有 viewAs": SKILLS.filter(s => s.hasViewAs).length,
        "有 cost": SKILLS.filter(s => s.hasCost).length,
        "锁定技": SKILLS.filter(s => s.forced).length,
        "限定技": SKILLS.filter(s => s.limited).length,
        "主动技": SKILLS.filter(s => s.hasEnable).length,
        "有 mod": SKILLS.filter(s => s.hasMod).length,
        "有子技能": SKILLS.filter(s => s.hasSubSkill).length,
    };
    console.log(`\n特征分布:`);
    for (const [k, v] of Object.entries(f)) console.log(`  ${k.padEnd(18)} ${v}`);
    // 高频触发时机
    const trigCount = {};
    for (const s of SKILLS) for (const t of s.triggers || []) trigCount[t] = (trigCount[t] || 0) + 1;
    const top = Object.entries(trigCount).sort((a, b) => b[1] - a[1]).slice(0, 12);
    console.log(`\n高频触发时机 Top 12:`);
    for (const [t, c] of top) console.log(`  ${t.padEnd(34)} ${c}`);
    console.log("");
}

function cmdRebuild() {
    console.log("正在重建索引…\n");
    try {
        const out = execFileSync(process.execPath, [join(HERE, "build-index.mjs")], { encoding: "utf8", stdio: "inherit" });
    } catch (e) {
        console.error("重建失败:", e.message);
        process.exit(1);
    }
}

// ── 知识沉淀 ───────────────────────────────────────────────

/**
 * learn —— 把检索得到的结论沉淀进知识库
 *
 * 用法：
 *   node skill-search.mjs learn --title "判定用 forResult" --body "..." \
 *        --kind pattern --keywords "判定,judge" --from rin_baoqiu [--from biyue]
 *
 * --from 指定的技能 ID 会生成**证据指纹**：记录其源码位置与内容哈希。
 * 之后读取该知识时会校验指纹，源码变动即标记失效。
 */
function cmdLearn() {
    const title = opt("--title");
    const body = opt("--body");
    if (!title || !body) {
        console.error(`用法: node skill-search.mjs learn --title "标题" --body "结论内容" [选项]

选项:
  --kind K        pattern | pitfall | recipe | fact（默认 fact）
  --keywords K    逗号分隔的关键词，用于检索匹配
  --from ID       技能 ID（可多次指定），生成证据指纹
  --link PATH     文档路径（可多次指定，相对项目根），如 docs/YRD/17-build-and-packaging.md
  --id ID         自定义知识 ID（默认由标题生成）
  --confidence C  verified | likely | tentative（默认 verified）

说明:
  --from  绑定具体源码位置，源码变动时该条自动标记失效
  --link  指向已成篇的文档；正文只写「结论摘要 + 何时看文档」，细节留在文档里
          两者可同时使用；kb-lint 会校验 --link 的文件确实存在

示例:
  node skill-search.mjs learn \\
    --title "判定用 judge().forResult()" \\
    --body "现代写法：const r = await player.judge().forResult(); r.color 为 red/black" \\
    --kind pattern --keywords "判定,judge,结果,红黑" --from rin_baoqiu

  node skill-search.mjs learn \\
    --title "扩展产物由扩展工程自己的 vite build 产出" \\
    --body "详见文档。要点：自建扩展源码在 packages/extension/<名>/，构建产物落在 apps/core/extension/<名>/，\`pnpm build\` 对扩展只做 fs.cp 纯复制。" \\
    --kind fact --keywords "打包,构建,extension,产物" --link docs/YRD/17-build-and-packaging.md`);
        process.exit(1);
    }

    const kind = opt("--kind", "fact");
    const confidence = opt("--confidence", "verified");
    const keywords = (opt("--keywords", "") || "").split(",").map(s => s.trim()).filter(Boolean);

    // 收集所有 --from（可能多次出现）
    const fromIds = [];
    for (let i = 0; i < argv.length; i++) {
        if (argv[i] === "--from" && argv[i + 1]) fromIds.push(argv[i + 1]);
    }

    // 收集所有 --link（可能多次出现）—— 指向**文档**的引用，不生成指纹
    // 用途：结论已写成文档时，让知识库直接指向该文档，避免正文重复长篇内容。
    // 路径相对**项目根**（如 docs/YRD/17-build-and-packaging.md），kb-lint 会校验其存在。
    const links = [];
    for (let i = 0; i < argv.length; i++) {
        if (argv[i] === "--link" && argv[i + 1]) links.push(argv[i + 1]);
    }

    // 生成指纹
    const fingerprints = [];
    const refs = [];
    for (const id of fromIds) {
        const skill = SKILLS.find(s => s.id === id);
        if (!skill) {
            console.error(`⚠ 未找到技能 "${id}"，跳过其指纹`);
            continue;
        }
        const fp = makeFingerprint(ROOT, skill.file, skill.line, skill.endLine);
        if (fp) {
            fingerprints.push(fp);
            refs.push(`${skill.id} @ ${skill.file}:${skill.line}-${skill.endLine}`);
        }
    }

    // 追加文档链接（放在技能引用之后）
    for (const link of links) {
        refs.push(link);
    }

    const id = opt("--id") || "kb-" + hashText(title).slice(0, 8);
    const record = KB.put({
        id, kind, title, body, keywords, refs, fingerprints, confidence,
    });
    KB.save();

    console.log(`\n✅ 已沉淀知识`);
    console.log(`   ID:     ${record.id}`);
    console.log(`   类型:   ${record.kind}`);
    console.log(`   标题:   ${record.title}`);
    if (keywords.length) console.log(`   关键词: ${keywords.join(", ")}`);
    if (fingerprints.length) {
        console.log(`   指纹:   ${fingerprints.length} 条（源码变动时会自动标记失效）`);
        for (const r of refs.filter(r => !links.includes(r))) console.log(`           · ${r}`);
    } else {
        console.log(`   指纹:   无（该结论不依赖具体源码位置，长期有效）`);
    }
    if (links.length) {
        console.log(`   文档:   ${links.length} 篇`);
        for (const l of links) console.log(`           · ${l}`);
    }
    console.log("");
}

/** kb —— 知识库管理 */
function cmdKb() {
    const sub = argv[1] || "list";

    if (sub === "list") {
        const all = KB.list();
        if (!all.length) {
            console.log("\n知识库为空。用 learn 命令沉淀第一条结论。\n");
            return;
        }
        console.log(`\n═══ 知识库（${all.length} 条）═══\n`);
        const icon = { fresh: "✓", stale: "⚠", missing: "✗" };
        for (const e of all) {
            const kindLabel = { pattern: "写法", pitfall: "坑点", recipe: "配方", fact: "事实" }[e.kind] || e.kind;
            console.log(`${icon[e.status] || "?"} 【${e.title}】 [${kindLabel}] ${e.id}`);
            if (e.status !== "fresh") {
                console.log(`    状态: ${e.status === "missing" ? "依据文件已不存在" : "依据源码已变动"}`);
                for (const fp of e.fingerprints || []) {
                    const st = verifyFingerprint(ROOT, fp);
                    console.log(`      · ${fp.file}:${fp.start}-${fp.end} → ${st}`);
                }
            }
            if (e.keywords?.length) console.log(`    关键词: ${e.keywords.join(", ")}`);
        }
        console.log("");
        return;
    }

    if (sub === "check") {
        const all = KB.list();
        const bad = all.filter(e => e.status !== "fresh");
        if (!bad.length) {
            console.log(`\n✅ 全部 ${all.length} 条知识指纹校验通过\n`);
            return;
        }
        console.log(`\n⚠️  ${bad.length} / ${all.length} 条知识已失效：\n`);
        for (const e of bad) {
            console.log(`【${e.title}】 ${e.id}`);
            console.log(`   ${e.body.slice(0, 120)}${e.body.length > 120 ? "…" : ""}`);
            for (const fp of e.fingerprints || []) {
                const st = verifyFingerprint(ROOT, fp);
                console.log(`   依据 ${fp.file}:${fp.start}-${fp.end} → ${st}`);
            }
            console.log(`   处理: node skill-search.mjs kb forget ${e.id}`);
            console.log("");
        }
        return;
    }

    if (sub === "show") {
        const id = argv[2];
        const e = KB.get(id);
        if (!e) {
            console.error(`未找到知识: ${id}`);
            process.exit(1);
        }
        const kindLabel = { pattern: "写法", pitfall: "坑点", recipe: "配方", fact: "事实" }[e.kind] || e.kind;
        console.log(`\n【${e.title}】`);
        console.log(`ID: ${e.id}  类型: ${kindLabel}  置信度: ${e.confidence}  状态: ${e.status}`);
        console.log(`\n${e.body}`);
        if (e.keywords?.length) console.log(`\n关键词: ${e.keywords.join(", ")}`);
        // refs 混合两类：技能引用（含 @）与文档链接（纯路径）—— 分开展示更清晰
        const skillRefs = (e.refs || []).filter(r => r.includes("@"));
        const docLinks = (e.refs || []).filter(r => !r.includes("@"));
        if (skillRefs.length) console.log(`依据: ${skillRefs.join("  ")}`);
        if (docLinks.length) {
            console.log(`\n📄 相关文档:`);
            for (const l of docLinks) console.log(`   · ${l}`);
        }
        console.log(`\n创建: ${e.createdAt}\n更新: ${e.updatedAt}\n`);
        return;
    }

    if (sub === "forget") {
        const id = argv[2];
        if (!id) {
            console.error("用法: node skill-search.mjs kb forget <id>");
            process.exit(1);
        }
        if (KB.remove(id)) {
            KB.save();
            console.log(`✓ 已移除知识: ${id}`);
        } else {
            console.error(`未找到知识: ${id}`);
            process.exit(1);
        }
        return;
    }

    if (sub === "stats") {
        const s = KB.stats();
        console.log(`\n═══ 知识库统计 ═══`);
        console.log(`路径:     ${s.path}`);
        console.log(`条目总数: ${s.total}`);
        console.log(`更新时间: ${s.updatedAt || "(从未)"}`);
        if (s.total) {
            console.log(`\n按类型:`);
            for (const [k, v] of Object.entries(s.byKind)) {
                const label = { pattern: "写法", pitfall: "坑点", recipe: "配方", fact: "事实" }[k] || k;
                console.log(`  ${label.padEnd(6)} ${v}`);
            }
            console.log(`\n按状态:`);
            for (const [k, v] of Object.entries(s.byStatus)) {
                const label = { fresh: "有效", stale: "失效(源码变动)", missing: "失效(文件不存在)" }[k] || k;
                console.log(`  ${label.padEnd(20)} ${v}`);
            }
        }
        console.log("");
        return;
    }

    console.error(`未知子命令: ${sub}`);
    console.error(`可用: list | check | show <id> | forget <id> | stats`);
    process.exit(1);
}

function cmdHelp() {
    console.log(`
无名杀技能检索工具

  search "<语义描述>"   搜索技能。先查知识库（校验指纹），再查技能索引
      --limit N         返回条数（默认 12）
      --source X        character | extension | core | all（默认 all）
      --impl            仅返回有实现的技能
      --no-kb           跳过知识库，只查索引
      --json            JSON 输出

  show <技能ID>         查看技能的完整实现源码（带行号）

  similar <技能ID>      找出与指定技能相似的技能

  learn                 沉淀结论到知识库（带源码指纹，自动失效检测）
      --title T         标题（必填）
      --body B          结论内容（必填）
      --kind K          pattern | pitfall | recipe | fact（默认 fact）
      --keywords K      逗号分隔关键词
      --from ID         技能 ID（可多次），生成证据指纹
      --link PATH       文档路径（可多次，相对项目根），如 docs/YRD/17-build-and-packaging.md
      --confidence C    verified | likely | tentative（默认 verified）

  kb <子命令>           知识库管理
      list              列出全部（含失效状态）
      check             只列出失效的知识
      show <id>         查看某条详情
      forget <id>       移除某条
      stats             统计

  stats                 索引统计

  rebuild               重建索引（源码变更后运行）

示例:
  node skill-search.mjs search "摸牌阶段多摸一张牌"
  node skill-search.mjs search "viewAs 将红色牌当杀" --impl
  node skill-search.mjs show biyue
  node skill-search.mjs similar wusheng

  # 沉淀结论
  node skill-search.mjs learn \\
    --title "判定用 judge().forResult()" \\
    --body "const r = await player.judge().forResult(); r.color 为 red/black" \\
    --kind pattern --keywords "判定,judge,红黑" --from rin_baoqiu

  node skill-search.mjs kb check
`);
}

switch (cmd) {
    case "search": cmdSearch(); break;
    case "locate": cmdLocate(); break;
    case "show": cmdShow(); break;
    case "similar": cmdSimilar(); break;
    case "learn": cmdLearn(); break;
    case "kb": cmdKb(); break;
    case "stats": cmdStats(); break;
    case "rebuild": cmdRebuild(); break;
    default: cmdHelp();
}
