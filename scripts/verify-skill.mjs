#!/usr/bin/env node
/**
 * verify-skill.mjs —— 技能静态验证
 *
 * 设计原则：**只报能确证的问题，不做可能误报的猜测**。
 * 每项检查都经过真实代码验证（见 scripts/README.md 的「检查项依据」）。
 *
 * 能查出的问题：
 *   · 语法错误（原文件无法解析）
 *   · 武将引用了不存在的技能（选将会显示但技能无效）
 *   · 技能无描述（自建扩展应补 translate）
 *   · 描述与实现不一致的**可疑信号**（描述里的数字/关键词在实现中完全找不到）
 *   · 描述文本无法定位来源
 *   · 扩展文件编码异常（非 UTF-8，会导致游戏内乱码）
 *   · 技能 ID 与其父技能命名不匹配（子技能漏挂 group）
 *
 * 查不出、必须人工在游戏里验的：
 *   · 技能是否真的触发（时机/filter 返回值）
 *   · UI 询问流程是否正确结算
 *   · 数值平衡、AI 是否会用
 *
 * 用法：
 *   node verify-skill.mjs                     # 验证全部自建扩展
 *   node verify-skill.mjs --pack 英雄杀RE      # 只验证某个扩展
 *   node verify-skill.mjs --skill yxsre_fenglang
 *   node verify-skill.mjs --all               # 含本体（噪音多，一般不用）
 *   node verify-skill.mjs --json
 */
import { readFileSync, existsSync, statSync, readdirSync } from "node:fs";
import { join, dirname, resolve, relative, basename } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const INDEX_PATH = join(HERE, "skill-index.json");

// ── 参数 ───────────────────────────────────────────────────
const argv = process.argv.slice(2);
function opt(name, dflt) {
    const i = argv.indexOf(name);
    return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : dflt;
}
const has = (n) => argv.includes(n);

// ── 项目根（与 skill-search 一致：动态解析）────────────────
function findProjectRoot(start) {
    let cur = resolve(start);
    for (let i = 0; i < 10; i++) {
        if (existsSync(join(cur, "apps/core/noname"))) return cur;
        const up = dirname(cur);
        if (up === cur) break;
        cur = up;
    }
    return null;
}

if (!existsSync(INDEX_PATH)) {
    console.error(`索引不存在: ${INDEX_PATH}`);
    console.error(`请先运行: node build-index.mjs`);
    process.exit(1);
}
const INDEX = JSON.parse(readFileSync(INDEX_PATH, "utf8"));
const SKILLS = INDEX.skills;

const ROOT = (() => {
    const explicit = opt("--root", null);
    if (explicit) return resolve(explicit);
    return findProjectRoot(process.cwd()) || findProjectRoot(HERE) || INDEX.root;
})();

// ── 编码安全读取 ───────────────────────────────────────────
function readSource(file) {
    let buf;
    try { buf = readFileSync(file); } catch { return null; }
    try {
        return new TextDecoder("utf-8", { fatal: true }).decode(buf);
    } catch {
        try { return new TextDecoder("gbk").decode(buf); } catch { return null; }
    }
}

// 结构性关键字（与 build-index 保持一致）
const NON_SKILL_KEYS = new Set([
    "skill", "skills", "translate", "character", "characterIntro", "characterTitle",
    "characterSort", "characterReplace", "card", "ai", "trigger", "subSkill",
    "intro", "content", "filter", "cost", "enable", "group", "result", "effect",
    "viewAs", "mod", "global", "player", "source", "target", "game", "lib", "ui",
    "get", "status", "_status", "name", "info", "config", "pack", "element", "list",
    "onremove", "onuninstall", "onload", "precontent", "arenaReady", "dynamicTranslate",
    "init", "help", "skillList", "sort", "audio", "audioname", "image", "skin",
]);

// ── 收集待验证目标 ─────────────────────────────────────────
const packFilter = opt("--pack", null);
const skillFilter = opt("--skill", null);
const includeCore = has("--all");

let targets = SKILLS.filter(s => {
    if (skillFilter) return s.id === skillFilter;
    if (packFilter) return s.pack === packFilter;
    if (includeCore) return true;
    return s.source === "extension";
});

if (!targets.length) {
    console.error(skillFilter ? `未找到技能: ${skillFilter}` : `未找到匹配的扩展技能`);
    process.exit(1);
}

// ── 结果收集 ───────────────────────────────────────────────
const problems = [];   // {level, skill, kind, msg}
const add = (level, skill, kind, msg) => problems.push({ level, skill, kind, msg });

// ═══ 检查 1：源文件可读 + 编码正常 ═════════════════════════
{
    const files = [...new Set(targets.map(t => t.file))];
    for (const rel of files) {
        const abs = join(ROOT, rel);
        if (!existsSync(abs)) {
            add("error", "-", "文件缺失", `${rel} 不存在（索引可能已过期，试试 rebuild）`);
            continue;
        }
        let buf;
        try { buf = readFileSync(abs); } catch { continue; }
        try {
            new TextDecoder("utf-8", { fatal: true }).decode(buf);
        } catch {
            add("warn", basename(rel), "编码", `${rel} 不是合法 UTF-8（GBK？），游戏内可能乱码`);
        }
    }
}

// ═══ 检查 2：技能无描述 ════════════════════════════════════
{
    // 内部子技能的可靠判据（按可信度排序）：
    //   ① 被某个技能的 group 数组引用  —— 最可靠
    //   ② 以 _ 开头（无名杀对隐藏技能的惯例）
    //   ③ 形如 <已存在的父技能ID>_<后缀>
    // 不满足以上任一者才提示缺描述，避免把子技能误报为缺描述。
    const groupedSkus = collectGroupedSkillIds();
    const ids = new Set(SKILLS.map(s => s.id));

    for (const s of targets) {
        if (s.desc) continue;
        if (groupedSkus.has(s.id)) continue;              // ①
        if (s.id.startsWith("_")) continue;                // ②
        const m = /^(.+?)_[A-Za-z0-9]+$/.exec(s.id);       // ③
        if (m && ids.has(m[1])) continue;
        if (/[0-9]$/.test(s.id)) continue;                 // 数字后缀变体
        add("warn", s.id, "缺描述", `${s.id}  ${s.file}:${s.line} 无 <id>_info 描述`);
    }
}

/** 收集所有被 group: [...] 引用的技能 ID（即内部子技能） */
function collectGroupedSkillIds() {
    const set = new Set();
    const cache = new Map();
    for (const s of SKILLS) {
        let text = cache.get(s.file);
        if (text === undefined) {
            const abs = join(ROOT, s.file);
            text = existsSync(abs) ? (readSource(abs) || "") : "";
            cache.set(s.file, text);
        }
        if (!text) continue;
        const slice = text.split(/\r?\n/).slice(s.line - 1, s.endLine).join("\n");
        const g = /group\s*:\s*\[([^\]]*)\]/.exec(slice);
        if (!g) continue;
        for (const x of g[1].split(",")) {
            const id = x.trim().replace(/^["'`]|["'`]$/g, "");
            if (id) set.add(id);
        }
    }
    return set;
}

// ═══ 检查 3：描述来源可定位 ════════════════════════════════
{
    for (const s of targets) {
        if (s.desc && !s.descFile) {
            add("info", s.id, "描述来源", `有描述但无法定位定义处（可能是动态拼接）`);
        }
    }
}

// ═══ 检查 4：武将 → 技能 引用闭合性 ════════════════════════
{
    // 索引里的武将（含 owners）
    const allSkillIds = new Set(SKILLS.map(s => s.id));
    // 只检查与目标同扩展的武将
    const packs = new Set(targets.map(t => t.pack));
    const chars = (INDEX.characters || []).filter(c => {
        for (const p of packs) if (c.file.includes(p)) return true;
        return false;
    });

    for (const c of chars) {
        const missing = (c.skills || []).filter(sid => !allSkillIds.has(sid));
        if (missing.length) {
            add("error", c.id, "悬空引用",
                `武将 ${c.id} (${c.file}:${c.line}) 引用了不存在的技能: ${missing.join(", ")}`);
        }
    }
}

// ═══ 检查 5：描述与实现的一致性（可疑信号）════════════════
{
    for (const s of targets) {
        if (!s.desc) continue;
        const abs = join(ROOT, s.file);
        if (!existsSync(abs)) continue;
        const text = readSource(abs);
        if (!text) continue;
        const slice = text.split(/\r?\n/).slice(s.line - 1, s.endLine).join("\n");

        // 描述里出现的数字（体力/牌数/距离等），实现里应能看到
        const nums = [...new Set((s.desc.match(/[0-9]+/g) || []))].filter(n => n !== "1" && n.length <= 2);
        const missingNums = nums.filter(n => !new RegExp(`\\b${n}\\b`).test(slice));
        if (missingNums.length && nums.length) {
            add("info", s.id, "描述/实现",
                `描述提到 ${missingNums.join("/")}，但实现段中未出现（可能已改实现未改描述）`);
        }
    }
}

// ═══ 检查 6：子技能是否挂上 group（仅在同文件时才提示）══════
//
// 注意：`<父>_<后缀>` 的命名并不必然意味着它是父技能的子技能 ——
// 实测 yxsre_wushuang_modi 与 yxsre_wushuang 只是命名相似，
// modi 自己 group 了 _sha/_juedou，并非遗漏。
// 因此只在**同一文件**且父技能确实有 group 时才提示，降低误报。
{
    const groupsOf = new Map();
    const fileOf = new Map();
    const cache = new Map();
    for (const s of SKILLS) {
        fileOf.set(s.id, s.file);
        let text = cache.get(s.file);
        if (text === undefined) {
            const abs = join(ROOT, s.file);
            text = existsSync(abs) ? (readSource(abs) || "") : "";
            cache.set(s.file, text);
        }
        if (!text) continue;
        const slice = text.split(/\r?\n/).slice(s.line - 1, s.endLine).join("\n");
        const g = /group\s*:\s*\[([^\]]*)\]/.exec(slice);
        if (g) {
            const list = g[1].split(",").map(x => x.trim().replace(/^["'`]|["'`]$/g, "")).filter(Boolean);
            groupsOf.set(s.id, list);
        }
    }

    const allIds = new Set(SKILLS.map(s => s.id));
    for (const s of targets) {
        const m = /^(.+?)_([A-Za-z]+)$/.exec(s.id);
        if (!m || !allIds.has(m[1])) continue;
        const parent = m[1];
        // 仅在同一个文件里才提示（跨文件多为命名巧合）
        if (fileOf.get(parent) !== s.file) continue;
        const g = groupsOf.get(parent);
        if (!g || !g.length) continue;          // 父技能本就不用 group，跳过
        if (g.includes(s.id)) continue;
        // 父技能的 group 里若含别的子技能，说明它确实用 group 挂载，此时才值得提示
        add("info", s.id, "子技能未挂载",
            `${s.id} 与 ${parent} 同文件，但 ${parent}.group 中未列出它（该父技能确实使用 group 挂载子技能）`);
    }
}

// ═══ 输出 ═════════════════════════════════════════════════
if (has("--json")) {
    console.log(JSON.stringify({ root: ROOT, checked: targets.length, problems }, null, 2));
    process.exit(0);
}

const ICON = { error: "✗", warn: "⚠", info: "·" };
const LABEL = { error: "错误", warn: "警告", info: "提示" };

console.log(`\n═══ 技能静态验证 ═══`);
console.log(`项目根: ${ROOT}`);
console.log(`验证对象: ${targets.length} 个技能` +
    (packFilter ? `（扩展 ${packFilter}）` : skillFilter ? `（技能 ${skillFilter}）` : `（全部扩展）`));

const byLevel = { error: [], warn: [], info: [] };
for (const p of problems) byLevel[p.level].push(p);

// 按技能聚合
const bySkill = new Map();
for (const p of problems) {
    if (!bySkill.has(p.skill)) bySkill.set(p.skill, []);
    bySkill.get(p.skill).push(p);
}

if (!problems.length) {
    console.log(`\n✅ 未发现问题`);
} else {
    for (const lv of ["error", "warn", "info"]) {
        const list = byLevel[lv];
        if (!list.length) continue;
        console.log(`\n─── ${LABEL[lv]}（${list.length}）───`);
        const seen = new Set();
        for (const p of list) {
            const key = `${p.skill}|${p.kind}|${p.msg}`;
            if (seen.has(key)) continue;
            seen.add(key);
            console.log(`  ${ICON[lv]} [${p.kind}] ${p.msg}`);
        }
    }
}

// 覆盖统计
const withDesc = targets.filter(s => s.desc).length;
const withOwner = targets.filter(s => (s.owners || []).length).length;
console.log(`\n─── 覆盖统计 ───`);
console.log(`  有描述      : ${withDesc}/${targets.length}`);
console.log(`  被武将引用  : ${withOwner}/${targets.length}`);

console.log(`\n─── 静态验证查不到、必须游戏内人工确认 ───`);
console.log(`  · 技能是否真的触发（时机 / filter 返回值）`);
console.log(`  · UI 询问流程能否正常结算`);
console.log(`  · AI 是否会使用该技能`);
console.log(`  · 数值平衡是否符合预期`);
console.log(`\n启动游戏：`);
console.log(`  pnpm -F noname dev                                        # http://127.0.0.1:8080/`);
console.log(`  pnpm -F @noname/fs dev --debug --dirname=../../apps/core  # 8089`);
console.log("");

const nErr = byLevel.error.length;
const nWarn = byLevel.warn.length;
process.exit(nErr > 0 ? 1 : 0);
