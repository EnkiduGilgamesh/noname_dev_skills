#!/usr/bin/env node
/**
 * 无名杀技能索引构建器
 *
 * 解析项目内的技能定义，抽取：
 *   - 技能 ID、来源文件、行号
 *   - 技能描述（从 translate 表 / subSkill.description / intro 提取）
 *   - 结构化特征（触发时机、字段类型、关键 API 调用）
 *
 * 产物：skill-index.json（供 skill-search.mjs 检索）
 *
 * 用法：node build-index.mjs [--root <项目根>] [--out <输出文件>]
 */
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
function argOf(name, dflt) {
    const i = args.indexOf(name);
    return i >= 0 && args[i + 1] ? args[i + 1] : dflt;
}

const HERE = dirname(fileURLToPath(import.meta.url));

// ── 定位项目根（含 apps/core 的目录）────────────────────────
function findRoot(start) {
    let cur = resolve(start);
    for (let i = 0; i < 10; i++) {
        if (existsSync(join(cur, "apps/core/noname"))) return cur;
        const up = dirname(cur);
        if (up === cur) break;
        cur = up;
    }
    return null;
}

/**
 * 项目根解析顺序：① --root ② 从 cwd 向上找 ③ 从本脚本位置向上找
 *
 * ③ 是为「技能目录就在项目内」的常规场景服务；
 * 当技能位于独立仓库（项目外）时必须用 --root 或从项目内运行。
 */
const ROOT = (() => {
    const explicit = argOf("--root", null);
    if (explicit) {
        const r = resolve(explicit);
        if (!existsSync(join(r, "apps/core/noname"))) {
            console.error(`⚠ --root 指定的目录不含 apps/core/noname: ${r}`);
            process.exit(1);
        }
        return r;
    }
    return findRoot(process.cwd()) || findRoot(HERE) || null;
})();

if (!ROOT) {
    console.error("⚠ 无法定位《无名杀》项目根（需包含 apps/core/noname）");
    console.error("  请在项目目录内运行，或显式指定: node build-index.mjs --root <项目根>");
    process.exit(1);
}

// 输出默认写到【本脚本所在目录】—— 这样独立仓库场景下索引也会落在仓库内
const OUT = argOf("--out", join(HERE, "skill-index.json"));
const CORE = join(ROOT, "apps/core");

const SEARCH_DIRS = [
    join(CORE, "character"),
    join(CORE, "extension"),
    join(CORE, "noname/library"),
];

// ── 工具函数 ───────────────────────────────────────────────

/** 递归收集指定文件名 */
function collect(dir, names, out = []) {
    if (!existsSync(dir)) return out;
    for (const entry of readdirSync(dir)) {
        const p = join(dir, entry);
        let st;
        try { st = statSync(p); } catch { continue; }
        if (st.isDirectory()) {
            if (entry === "node_modules" || entry.startsWith(".")) continue;
            collect(p, names, out);
        } else if (names.includes(entry)) {
            out.push(p);
        }
    }
    return out;
}

/** 从文件内容里抽取 `\t\t\t<skillId>_info: "..."` 形式的描述 */
function extractInfoTranslations(text) {
    const map = new Map();
    const re = /^\t{1,3}([A-Za-z_$][\w$]*)_info\s*:\s*(`(?:[^`\\]|\\.)*`|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/gm;
    let m;
    while ((m = re.exec(text)) !== null) {
        const raw = m[2];
        const body = raw.slice(1, -1);
        map.set(m[1], body.replace(/\\"/g, '"').replace(/\\'/g, "'").replace(/\\n/g, "\n"));
    }
    return map;
}

/** 抽取 `\t<id>: "..."` 形式的名字翻译 */
function extractNameTranslations(text) {
    const map = new Map();
    const re = /^\t{1,2}([A-Za-z_$][\w$]*)\s*:\s*("(?:[^"\\]|\\.)*")/gm;
    let m;
    while ((m = re.exec(text)) !== null) {
        map.set(m[1], m[2].slice(1, -1));
    }
    return map;
}

/**
 * 解析技能定义块。
 *
 * 约定（经全库统计验证）：顶层技能统一为「1 个 Tab 缩进 + name: {」。
 * 通过花括号配平找到块的结束位置。
 */
function extractSkillBlocks(text) {
    const lines = text.split(/\r?\n/);
    const blocks = [];
    const re = /^\t([A-Za-z_$][\w$]*)\s*:\s*\{/;

    for (let i = 0; i < lines.length; i++) {
        const m = re.exec(lines[i]);
        if (!m) continue;
        const id = m[1];

        // 花括号配平（跳过字符串与注释中的括号）
        let depth = 0, end = -1;
        let inBlockComment = false;
        for (let j = i; j < lines.length; j++) {
            const line = lines[j];
            let k = 0;
            let inStr = null;
            while (k < line.length) {
                const ch = line[k];
                const nx = line[k + 1];
                if (inBlockComment) {
                    if (ch === "*" && nx === "/") { inBlockComment = false; k += 2; continue; }
                    k++; continue;
                }
                if (inStr) {
                    if (ch === "\\") { k += 2; continue; }
                    if (ch === inStr) { inStr = null; }
                    k++; continue;
                }
                if (ch === "/" && nx === "*") { inBlockComment = true; k += 2; continue; }
                if (ch === "/" && nx === "/") break;
                if (ch === '"' || ch === "'" || ch === "`") { inStr = ch; k++; continue; }
                if (ch === "{") depth++;
                else if (ch === "}") {
                    depth--;
                    if (depth === 0) { end = j; break; }
                }
                k++;
            }
            if (end >= 0) break;
        }
        if (end < 0) continue;

        blocks.push({ id, startLine: i + 1, endLine: end + 1, body: lines.slice(i, end + 1).join("\n") });
        i = end; // 跳过已消费的行（避免把子技能当顶层）
    }
    return blocks;
}

/** 从技能块中提取结构化特征 */
function analyzeBlock(body) {
    const feat = {
        triggers: [],
        hasCost: false,
        hasFilter: false,
        hasContent: false,
        hasViewAs: false,
        hasEnable: false,
        hasMod: false,
        hasSubSkill: false,
        hasGroup: false,
        forced: false,
        limited: false,
        juexingji: false,
        direct: false,
        silent: false,
        tags: [],
        apis: [],
        subSkills: [],
    };

    // 触发时机：trigger 有两种写法
    //   单行  trigger: { player: "useCardAfter" },
    //   多行  trigger: {\n\t\t\tplayer: ["a","b"],\n\t\t}
    // 约束 role 必须是合法作用域，避免误匹配 viewAs/logTarget 等
    const VALID_ROLES = new Set(["player", "source", "target", "global", "phaseAny"]);
    const trigSingle = /\n\t\ttrigger\s*:\s*\{([^\n{}]*)\}/g;
    const trigMulti = /\n\t\ttrigger\s*:\s*\{([\s\S]*?)\n\t\t\}/g;
    const parseTrigInner = inner => {
        const re = /(\w+)\s*:\s*(\[[^\]]*\]|"(?:[^"\\]|\\.)*")/g;
        let m;
        while ((m = re.exec(inner)) !== null) {
            const role = m[1];
            if (!VALID_ROLES.has(role)) continue;
            const vals = m[2].match(/"([^"]*)"/g) || [];
            for (const v of vals) feat.triggers.push(`${role}:${v.slice(1, -1)}`);
        }
    };
    let tm;
    const seenStart = new Set();
    while ((tm = trigSingle.exec(body)) !== null) {
        parseTrigInner(tm[1]);
        seenStart.add(tm.index);
    }
    while ((tm = trigMulti.exec(body)) !== null) {
        if (seenStart.has(tm.index)) continue;
        parseTrigInner(tm[1]);
    }

    if (/^\t\thasCost|^\t\tasync cost\s*\(|^\t\tcost\s*[:(]/m.test(body) || /\n\t\t(async\s+)?cost\s*[:(]/.test(body)) feat.hasCost = true;
    if (/\n\t\t(async\s+)?filter\s*[:(]/.test(body)) feat.hasFilter = true;
    if (/\n\t\t(async\s+)?content\s*[:(]/.test(body)) feat.hasContent = true;
    if (/\n\t\tviewAs\s*[:(]/.test(body)) feat.hasViewAs = true;
    if (/\n\t\tenable\s*[:(]/.test(body)) feat.hasEnable = true;
    if (/\n\t\tmod\s*:\s*\{/.test(body)) feat.hasMod = true;
    if (/\n\t\tsubSkill\s*:\s*\{/.test(body)) feat.hasSubSkill = true;
    if (/\n\t\tgroup\s*:/.test(body)) feat.hasGroup = true;
    if (/\n\t\tforced\s*:\s*true/.test(body)) feat.forced = true;
    if (/\n\t\tlimited\s*:\s*true/.test(body)) feat.limited = true;
    if (/\n\t\tjuexingji\s*:\s*true/.test(body)) feat.juexingji = true;
    if (/\n\t\tdirect\s*:\s*true/.test(body)) feat.direct = true;
    if (/\n\t\tsilent\s*:\s*true/.test(body)) feat.silent = true;

    // 关键 API 调用
    const apiRe = /(?:player|target|source|trigger\.\w+|game|event)\s*\.\s*(draw|damage|loseHp|recover|discard|gain|chooseToDiscard|chooseCard|chooseTarget|chooseBool|chooseToUse|chooseToRespond|chooseControl|chooseButton|addTempSkill|addSkills|removeSkill|markAuto|unmarkAuto|awakenSkill|turnOver|gainMaxHp|loseMaxHp|useCard|judge|gainPlayerCard|discardPlayerCard|addToExpansion|loseToDiscardpile)\s*\(/g;
    let a;
    while ((a = apiRe.exec(body)) !== null) {
        if (!feat.apis.includes(a[1])) feat.apis.push(a[1]);
    }

    // 子技能名
    const subRe = /\n\t\tsubSkill\s*:\s*\{([\s\S]*?)\n\t\t\}/.exec(body);
    if (subRe) {
        const sre = /^\t\t\t([A-Za-z_$][\w$]*)\s*:\s*\{/gm;
        let s;
        while ((s = sre.exec(subRe[1])) !== null) feat.subSkills.push(`${feat.id || ""}_${s[1]}`);
    }

    return feat;
}

// ── 主流程 ─────────────────────────────────────────────────

console.log(`项目根: ${ROOT}`);

const skillFiles = [];
for (const d of SEARCH_DIRS) collect(d, ["skill.js", "skill.ts"], skillFiles);
console.log(`发现 skill 文件: ${skillFiles.length} 个`);

// 1) 先在全局范围收集翻译（描述可能定义在同目录 translate.js）
const infoBySkill = new Map();
const nameBySkill = new Map();
const translateFiles = [];
for (const d of SEARCH_DIRS) collect(d, ["translate.js", "translate.ts", "index.js", "index.ts"], translateFiles);
for (const f of translateFiles) {
    let text;
    try { text = readFileSync(f, "utf8"); } catch { continue; }
    for (const [k, v] of extractInfoTranslations(text)) {
        if (!infoBySkill.has(k)) infoBySkill.set(k, v);
    }
    for (const [k, v] of extractNameTranslations(text)) {
        if (!nameBySkill.has(k)) nameBySkill.set(k, v);
    }
}
// skill.js 内部也可能直接写 translate（少数包）
for (const f of skillFiles) {
    let text;
    try { text = readFileSync(f, "utf8"); } catch { continue; }
    for (const [k, v] of extractInfoTranslations(text)) {
        if (!infoBySkill.has(k)) infoBySkill.set(k, v);
    }
}
console.log(`收集描述: ${infoBySkill.size} 条，名称: ${nameBySkill.size} 条`);

// 2) 解析每个 skill 文件
const skills = [];
for (const file of skillFiles) {
    let text;
    try { text = readFileSync(file, "utf8"); } catch { continue; }
    const rel = relative(ROOT, file).replace(/\\/g, "/");

    // 判定来源分类
    let source = "other";
    if (rel.includes("/extension/")) source = "extension";
    else if (rel.includes("/character/")) source = "character";
    else if (rel.includes("/library/")) source = "core";

    // 扩展名 / 包名
    let pack = "";
    let mm = /\/extension\/([^/]+)\//.exec(rel);
    if (mm) pack = mm[1];
    else {
        mm = /\/character\/([^/]+)\//.exec(rel);
        if (mm) pack = mm[1];
    }

    for (const block of extractSkillBlocks(text)) {
        const feat = analyzeBlock(block.body);
        feat.id = block.id;
        // 修正子技能全名
        feat.subSkills = feat.subSkills.map(s => s.replace(/^_/, `${block.id}_`));

        let desc = infoBySkill.get(block.id) || "";
        // 尝试把描述里的 HTML 标签转成可读文本（保留语义）
        const descPlain = desc
            .replace(/<br\s*\/?>/gi, " ")
            .replace(/<li>/gi, " · ")
            .replace(/<[^>]+>/g, "")
            .replace(/\$\{[^}]*\}/g, "")
            .replace(/\s+/g, " ")
            .trim();

        skills.push({
            id: block.id,
            name: nameBySkill.get(block.id) || "",
            desc: descPlain,
            descRaw: desc,
            source,
            pack,
            file: rel,
            line: block.startLine,
            endLine: block.endLine,
            ...feat,
        });
    }
}

console.log(`解析技能: ${skills.length} 个`);

// 3) 统计
const bySource = {};
for (const s of skills) bySource[s.source] = (bySource[s.source] || 0) + 1;
console.log("来源分布:", bySource);
const withDesc = skills.filter(s => s.desc).length;
console.log(`含描述的技能: ${withDesc} / ${skills.length}`);

// 4) 输出
const index = {
    builtAt: new Date().toISOString(),
    root: ROOT,
    counts: { total: skills.length, withDesc, bySource },
    skills,
};
writeFileSync(OUT, JSON.stringify(index, null, 0), "utf8");
console.log(`索引已写入: ${OUT} (${(JSON.stringify(index).length / 1024 / 1024).toFixed(2)} MB)`);
