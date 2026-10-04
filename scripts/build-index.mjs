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

/**
 * 读取源码文件 —— 自动处理非 UTF-8 编码。
 *
 * 部分老扩展（如 英雄杀RE）的 extension.js 是 **GBK** 编码。
 * 若直接按 UTF-8 读，中文会变成乱码但不报错（静默损坏），
 * 导致描述、注释无法正确提取。
 *
 * 策略：先严格 UTF-8 解码，失败则回退 GBK。
 */
function readSource(file) {
    let buf;
    try { buf = readFileSync(file); } catch { return null; }
    // 严格 UTF-8：遇非法字节序列抛错
    try {
        return new TextDecoder("utf-8", { fatal: true }).decode(buf);
    } catch {
        try {
            return new TextDecoder("gbk").decode(buf);
        } catch {
            return buf.toString("utf8");
        }
    }
}

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

/**
 * 收集过程中应跳过的目录。
 *
 * `help/`、`backups/` 里常有 extension.js 的**参考副本或旧备份**，
 * 扫描它们会产出重复条目与早已废弃的技能定义（实测噪音来源之一）。
 */
const SKIP_DIRS = new Set(["node_modules", "help", "backups", "backup", "example", "dist", "docs"]);

/** 递归收集指定文件名 */
function collect(dir, names, out = []) {
    if (!existsSync(dir)) return out;
    for (const entry of readdirSync(dir)) {
        const p = join(dir, entry);
        let st;
        try { st = statSync(p); } catch { continue; }
        if (st.isDirectory()) {
            if (entry.startsWith(".") || SKIP_DIRS.has(entry)) continue;
            collect(p, names, out);
        } else if (names.includes(entry)) {
            out.push(p);
        }
    }
    return out;
}

/** 从文件内容里抽取 `<skillId>_info: "..."` 形式的描述（缩进与引号风格均兼容） */
function extractInfoTranslations(text) {
    const map = new Map();
    const re = /^[ \t]{1,40}([A-Za-z_$][\w$]*)_info\s*:\s*(`(?:[^`\\]|\\.)*`|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/gm;
    let m;
    while ((m = re.exec(text)) !== null) {
        const raw = m[2];
        const body = raw.slice(1, -1);
        map.set(m[1], body.replace(/\\"/g, '"').replace(/\\'/g, "'").replace(/\\n/g, "\n"));
    }
    return map;
}

/**
 * 抽取描述 **及其所在行号** —— 修改技能时要直接跳到描述文本处改。
 *
 * 缩进兼容两种风格：Tab（本体/多数扩展）与空格（单文件扩展可深达 28 空格）。
 * 引号兼容单引号、双引号与反引号。
 * @returns {Map<string, {text:string, line:number, file:string}>}
 */
function extractInfoTranslationsWithPos(text, relFile) {
    const map = new Map();
    const re = /^[ \t]{1,40}([A-Za-z_$][\w$]*)_info\s*:\s*(`(?:[^`\\]|\\.)*`|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/gm;
    let m;
    while ((m = re.exec(text)) !== null) {
        const raw = m[2];
        const body = raw.slice(1, -1);
        const line = text.slice(0, m.index).split("\n").length;
        map.set(m[1], {
            text: body.replace(/\\"/g, '"').replace(/\\'/g, "'").replace(/\\n/g, "\n"),
            line,
            file: relFile,
        });
    }
    return map;
}

/**
 * 抽取「武将 → 技能列表」关系。
 *
 * 支持两种形态：
 *
 * A. 对象形态（本体与多数扩展）
 *     \tguojia: {
 *     \t\tsex: "male",
 *     \t\tskills: ["tiandu", "yiji"],
 *     \t},
 *
 * B. 紧凑数组形态（单文件扩展常见，缩进不稳定）
 *     yxsre_huoqubing:['male','han',3,['yxsre_fenglang','yxsre_tiandu'],[]],
 *     位置：[性别, 势力, 体力, [技能...], 皮肤/其他]
 *
 * 用于反查：改一个技能会影响哪些武将。
 * @returns {Array<{id:string,name:string,skills:string[],hp:number|null,line:number}>}
 */
function extractCharacters(text) {
    const chars = extractCharsObjectForm(text);
    chars.push(...extractCharsCompactForm(text));
    // 去重（同一 id 只留首个）
    const seen = new Set();
    return chars.filter(c => (seen.has(c.id) ? false : (seen.add(c.id), true)));
}

/** 形态 A：`id: { ... skills: [...] ... }` */
function extractCharsObjectForm(text) {
    const chars = [];
    // 顶层武将块：1 个 Tab + id + {
    const blockRe = /^\t([A-Za-z_$][\w$]*)\s*:\s*\{/gm;
    const starts = [];
    let m;
    while ((m = blockRe.exec(text)) !== null) {
        starts.push({ id: m[1], index: m.index, line: text.slice(0, m.index).split("\n").length });
    }
    for (let i = 0; i < starts.length; i++) {
        const s = starts[i];
        const end = i + 1 < starts.length ? starts[i + 1].index : text.length;
        const body = text.slice(s.index, end);
        // 必须含 skills 数组才算武将（排除嵌套的其它配置对象）
        const sk = /skills\s*:\s*\[([^\]]*)\]/.exec(body);
        if (!sk) continue;
        const skills = sk[1]
            .split(",")
            .map(x => x.trim().replace(/^["'`]|["'`]$/g, ""))
            .filter(x => /^[A-Za-z_$][\w$]*$/.test(x));
        if (!skills.length) continue;
        const hp = /\bhp\s*:\s*(\d+)/.exec(body);
        const nm = /\bnames?\.?[A-Za-z_$\w]*|\bname\s*:\s*["']([^"']+)["']/.exec(body);
        chars.push({
            id: s.id,
            name: nm && nm[1] ? nm[1] : "",
            skills,
            hp: hp ? Number(hp[1]) : null,
            line: s.line,
        });
    }
    return chars;
}

/**
 * 形态 B：紧凑数组 `id:['male','han',3,['skill1','skill2'],[]],`
 *
 * 通过「第 4 个元素是字符串数组」这一特征识别，避免把技能/卡牌定义误判成武将。
 */
function extractCharsCompactForm(text) {
    const chars = [];
    const re = /^[ \t]{1,40}([A-Za-z_$][\w$]*)\s*:\s*\[\s*['"](male|female)['"]\s*,\s*['"]([^'"]*)['"]\s*,\s*(\d+)\s*,\s*\[([^\]]*)\]/gm;
    let m;
    while ((m = re.exec(text)) !== null) {
        const skills = m[5]
            .split(",")
            .map(x => x.trim().replace(/^["'`]|["'`]$/g, ""))
            .filter(x => /^[A-Za-z_$][\w$]*$/.test(x));
        if (!skills.length) continue;
        chars.push({
            id: m[1],
            name: "",
            skills,
            hp: Number(m[4]),
            line: text.slice(0, m.index).split("\n").length,
        });
    }
    return chars;
}

/** 抽取技能/武将名字翻译（缩进与引号风格均兼容） */
function extractNameTranslations(text) {
    const map = new Map();
    const re = /^[ \t]{1,40}([A-Za-z_$][\w$]*)\s*:\s*("[^"\n]*"|'[^'\n]*')/gm;
    let m;
    while ((m = re.exec(text)) !== null) {
        map.set(m[1], m[2].slice(1, -1));
    }
    return map;
}

/**
 * 解析技能定义块。
 *
 * 技能块的识别分两种风格：
 *   A. 常规风格 —— 顶层技能统一为「1 个 Tab 缩进 + name: {」（本体与多数扩展）
 *   B. 容器风格 —— 扩展把技能放进 `skill: { ... }` 容器里（常见于
 *      `game.import("extension", ...)` 的 precontent 中构造 `var xxx = { character:{}, skill:{} }`）。
 *      这类技能缩进很深（实测可达 28 个空格），不能用固定缩进匹配。
 *
 * 实现：先按 A 风格扫（快且准，覆盖本体 7000+ 技能），
 *       若某文件一个都没扫到，则回退到 B 风格（按 skill 容器定位）。
 */
function extractSkillBlocks(text) {
    const a = extractBlocksByIndent(text);
    if (a.length) return a;
    return extractBlocksByContainer(text);
}

/** 风格 A：固定 1 个 Tab 缩进的顶层技能 */
function extractBlocksByIndent(text) {
    const lines = text.split(/\r?\n/);
    const blocks = [];
    const re = /^\t([A-Za-z_$][\w$]*)\s*:\s*\{/;

    for (let i = 0; i < lines.length; i++) {
        const m = re.exec(lines[i]);
        if (!m) continue;
        const id = m[1];

        // 同样要过滤结构性关键字 —— 否则扩展的 extension.js 里
        // 顶层 tab 缩进的包字段（config/help/package/files 等）
        // 会被当成技能，产生一批假的「缺描述」警告。
        if (!looksLikeSkillId(id)) continue;

        const end = matchBrace(lines, i);
        if (end < 0) continue;

        blocks.push({ id, startLine: i + 1, endLine: end + 1, body: lines.slice(i, end + 1).join("\n") });
        i = end; // 跳过已消费的行（避免把子技能当顶层）
    }

    return blocks;
}
/**
 * 结构性关键字 —— 它们在技能块内以 `xxx: {` 出现，但不是技能 ID。
 *
 * 容器风格解析时若不过滤，会把 skill / translate / ai / trigger 等
 * 当成技能写进索引（实测产生 18 条噪音，且会污染扩展的自检结果）。
 */
const NON_SKILL_KEYS = new Set([
    "skill", "skills", "translate", "character", "characterIntro", "characterTitle",
    "characterSort", "characterReplace", "card", "ai", "trigger", "subSkill",
    "intro", "content", "filter", "cost", "enable", "group", "result", "effect",
    "viewAs", "mod", "global", "player", "source", "target", "game", "lib", "ui",
    "get", "status", "_status", "name", "info", "config", "pack", "element", "list",
    "onremove", "onuninstall", "onload", "precontent", "arenaReady", "dynamicTranslate",
    "init", "help", "skillList", "sort", "audio", "audioname", "image", "skin",
    // 扩展包（extension.js 的 extensionPackage）自身字段：
    // 它们与技能无关，但单文件/扩展风格解析会误当成技能 ID
    // （实测「新宇杀」扩展会产生 4 条假「缺描述」警告）。
    "package", "files", "editable", "version",
]);

/** 判定一个键名是否可能是技能 ID */
function looksLikeSkillId(id) {
    return !NON_SKILL_KEYS.has(id);
}

/**
 * 风格 B：定位 `skill: {` 容器，收集其内**同级**的 `id: {` 条目。
 *
 * 同时兼容 `lib.skill = {` / `lib.skill.xxx = {` 写法。
 */
function extractBlocksByContainer(text) {
    const lines = text.split(/\r?\n/);
    const blocks = [];
    const indentOf = (s) => (/^(\s*)/).exec(s) ? (/^(\s*)/.exec(s))[1].length : 0;

    // 候选容器锚点：`skill: {`、`skills: {`、`lib.skill = {`
    const anchors = [];
    for (let i = 0; i < lines.length; i++) {
        if (/^\s*(skill|skills)\s*:\s*\{\s*$/.test(lines[i]) ||
            /^\s*lib\.skill\s*=\s*\{\s*$/.test(lines[i])) {
            anchors.push({ line: i, kind: "container" });
        }
    }
    // 单独的 lib.skill.xxx = { 每个就是一个技能
    for (let i = 0; i < lines.length; i++) {
        const m = /^(\s*)lib\.skill\.(\w+)\s*=\s*\{/.exec(lines[i]);
        if (m && looksLikeSkillId(m[2])) {
            const end = matchBrace(lines, i);
            if (end >= 0) {
                blocks.push({
                    id: m[2],
                    startLine: i + 1,
                    endLine: end + 1,
                    body: lines.slice(i, end + 1).join("\n"),
                });
            }
        }
    }

    for (const a of anchors) {
        const baseIndent = indentOf(lines[a.line]);
        let entryIndent = -1;
        for (let i = a.line + 1; i < lines.length; i++) {
            const line = lines[i];
            if (!line.trim()) continue;
            const ind = indentOf(line);
            // 容器结束
            if (ind <= baseIndent && /^\s*\}/.test(line)) break;
            const em = /^(\s*)([A-Za-z_$][\w$]*)\s*:\s*\{/.exec(line);
            if (!em) continue;
            const eInd = em[1].length;
            if (entryIndent < 0) entryIndent = eInd;
            if (eInd !== entryIndent) continue;   // 只取同级（子技能更深，跳过）
            const end = matchBrace(lines, i);
            if (end < 0) continue;
            // 过滤结构性关键字（skill/translate/ai/trigger/...）
            if (looksLikeSkillId(em[2])) {
                blocks.push({
                    id: em[2],
                    startLine: i + 1,
                    endLine: end + 1,
                    body: lines.slice(i, end + 1).join("\n"),
                });
            }
            i = end;
        }
    }


    // 去重（同一 id 只留首个）
    const seen = new Set();
    return blocks.filter(b => (seen.has(b.id) ? false : (seen.add(b.id), true)));
}

/**
 * 风格 B：从 `lib.skill = {` / `lib.skill.xxx = {` 起，收集该作用域内的技能。
 *
 * 判定方式：定位 lib.skill 赋值点，在其后扫描「同一缩进层级」的 `id: {` 条目，
 * 直到缩进回退到该层级以下为止。
 */
function extractBlocksByLibSkill(text) {
    const lines = text.split(/\r?\n/);
    const blocks = [];

    // 找所有 lib.skill（含 lib.skill.xxx =）赋值点
    const anchors = [];
    for (let i = 0; i < lines.length; i++) {
        if (/^\s*lib\.skill(\.\w+)?\s*=\s*\{/.test(lines[i])) {
            anchors.push(i);
        }
    }
    if (!anchors.length) return blocks;

    const indentOf = (s) => (/^(\s*)/.exec(s) || ["", ""])[1].length;

    for (const start of anchors) {
        const baseIndent = indentOf(lines[start]);
        // 找到该对象块的结束（缩进回到 baseIndent 或更少，且以 } 开头）
        let objStart = start;
        // 若是 lib.skill.xxx = {，技能就是这一整块
        const m = /^\s*lib\.skill\.(\w+)\s*=\s*\{/.exec(lines[objStart]);
        if (m) {
            const end = matchBrace(lines, objStart);
            if (end >= 0) {
                blocks.push({
                    id: m[1],
                    startLine: objStart + 1,
                    endLine: end + 1,
                    body: lines.slice(objStart, end + 1).join("\n"),
                });
            }
            continue;
        }
        // lib.skill = { 形式：收集内部同级条目
        let entryIndent = -1;
        for (let i = start + 1; i < lines.length; i++) {
            const line = lines[i];
            if (!line.trim()) continue;
            const ind = indentOf(line);
            // 到达对象结尾
            if (ind <= baseIndent && /^\s*\}/.test(line)) break;
            const em = /^(\s*)([A-Za-z_$][\w$]*)\s*:\s*\{/.exec(line);
            if (!em) continue;
            const eInd = em[1].length;
            if (entryIndent < 0) entryIndent = eInd;
            if (eInd !== entryIndent) continue;   // 只取同级（子技能更深，跳过）
            const end = matchBrace(lines, i);
            if (end < 0) continue;
            blocks.push({
                id: em[2],
                startLine: i + 1,
                endLine: end + 1,
                body: lines.slice(i, end + 1).join("\n"),
            });
            i = end;
        }
    }
    return blocks;
}

/** 花括号配平，返回与 lines[start] 中首个 { 配对的 } 所在行号 */
function matchBrace(lines, start) {
    let depth = 0, end = -1;
    let inBlockComment = false;
    for (let j = start; j < lines.length; j++) {
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
    return end;
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

/**
 * 收集所有可能含技能/武将定义的文件。
 *
 * 覆盖三种扩展布局：
 *   ① 标准多文件：skill.js / character.js / translate.js
 *   ② 单文件：全部塞在 extension.js
 *   ③ 模块化拆分：extension.js + character/skills/<分组>.js
 *      （拆分后每个分组文件 `export const skill = {...}` / `character = {...}`）
 *
 * ③ 用扩展名 + 目录特征匹配，避免把无关的 js 全扫进来。
 */
/**
 * 收集所有可能含**技能定义**的文件。
 *
 * 覆盖四种扩展布局：
 *   ① 标准多文件：skill.js
 *   ② 单文件：全部塞在 extension.js
 *   ③ 模块化拆分：extension.js + character/skills/<分组>.js
 *      （拆分后每个分组文件 `export const skill = {...}` / `character = {...}`）
 *
 * ⚠️ 不能把 character.js 当技能文件 —— 里面的键是【武将 ID】不是技能 ID，
 *    混入会让武将本身被当成技能索引（实测多出 2900+ 条噪音）。
 *    character.js 只用于提取「武将 → 技能」关系（见 charFiles）。
 */
function collectSkillFiles() {
    const out = new Set();
    for (const d of SEARCH_DIRS) {
        for (const f of collect(d, ["skill.js", "skill.ts", "extension.js", "extension.ts"])) out.add(f);
    }
    // 模块化拆分：<任意>/character/skills/*.js
    for (const d of SEARCH_DIRS) {
        const stack = [d];
        while (stack.length) {
            const cur = stack.pop();
            let entries;
            try { entries = readdirSync(cur); } catch { continue; }
            const inSkillsDir = cur.replace(/\\/g, "/").endsWith("/character/skills");
            for (const e of entries) {
                const p = join(cur, e);
                let st;
                try { st = statSync(p); } catch { continue; }
                if (st.isDirectory()) {
                    if (e === "node_modules" || e.startsWith(".")) continue;
                    stack.push(p);
                } else if (inSkillsDir && /\.(js|ts)$/.test(e)) {
                    out.add(p);
                }
            }
        }
    }
    return [...out];
}

const skillFiles = collectSkillFiles();
console.log(`发现源文件: ${skillFiles.length} 个`);

// 1) 先在全局范围收集翻译（描述可能定义在同目录 translate.js）
const infoBySkill = new Map();
const infoPosBySkill = new Map();      // 描述文本的来源位置（文件 + 行号）
const nameBySkill = new Map();
const translateFiles = [];
for (const d of SEARCH_DIRS) collect(d, ["translate.js", "translate.ts", "index.js", "index.ts", "extension.js", "extension.ts"], translateFiles);
for (const f of translateFiles) {
    let text;
    text = readSource(f); if (text === null) continue;
    const relT = relative(ROOT, f).replace(/\\/g, "/");
    for (const [k, v] of extractInfoTranslations(text)) {
        if (!infoBySkill.has(k)) infoBySkill.set(k, v);
    }
    for (const [k, v] of extractInfoTranslationsWithPos(text, relT)) {
        if (!infoPosBySkill.has(k)) infoPosBySkill.set(k, v);
    }
    for (const [k, v] of extractNameTranslations(text)) {
        if (!nameBySkill.has(k)) nameBySkill.set(k, v);
    }
}
// skill.js 内部也可能直接写 translate（少数包）
for (const f of skillFiles) {
    let text;
    text = readSource(f); if (text === null) continue;
    const relT = relative(ROOT, f).replace(/\\/g, "/");
    for (const [k, v] of extractInfoTranslations(text)) {
        if (!infoBySkill.has(k)) infoBySkill.set(k, v);
    }
    for (const [k, v] of extractInfoTranslationsWithPos(text, relT)) {
        if (!infoPosBySkill.has(k)) infoPosBySkill.set(k, v);
    }
}
console.log(`收集描述: ${infoBySkill.size} 条（含位置 ${infoPosBySkill.size} 条），名称: ${nameBySkill.size} 条`);

// 1b) 收集「武将 → 技能」关系，用于反查改动影响面
const charFiles = [];
for (const d of SEARCH_DIRS) collect(d, ["character.js", "character.ts", "extension.js", "extension.ts"], charFiles);
// 模块化拆分后，武将也写在 character/skills/<分组>.js 里（`export const character = {...}`）
{
    const stack = [...SEARCH_DIRS];
    while (stack.length) {
        const cur = stack.pop();
        let entries;
        try { entries = readdirSync(cur); } catch { continue; }
        const inSkillsDir = cur.replace(/\\/g, "/").endsWith("/character/skills");
        for (const e of entries) {
            const p = join(cur, e);
            let st;
            try { st = statSync(p); } catch { continue; }
            if (st.isDirectory()) {
                if (e.startsWith(".") || SKIP_DIRS.has(e)) continue;
                stack.push(p);
            } else if (inSkillsDir && /\.(js|ts)$/.test(e)) {
                charFiles.push(p);
            }
        }
    }
}
const characters = [];
for (const f of charFiles) {
    let text;
    text = readSource(f); if (text === null) continue;
    const relC = relative(ROOT, f).replace(/\\/g, "/");
    for (const c of extractCharacters(text)) {
        characters.push({ ...c, file: relC });
    }
}
// 技能 → 武将反查表
const ownersBySkill = new Map();
for (const c of characters) {
    for (const sid of c.skills) {
        if (!ownersBySkill.has(sid)) ownersBySkill.set(sid, []);
        ownersBySkill.get(sid).push({ id: c.id, file: c.file, line: c.line, hp: c.hp });
    }
}
console.log(`收集武将: ${characters.length} 个，覆盖技能 ${ownersBySkill.size} 个`);

// 2) 解析每个 skill 文件
const skills = [];
for (const file of skillFiles) {
    let text;
    text = readSource(file); if (text === null) continue;
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

        const pos = infoPosBySkill.get(block.id) || null;
        skills.push({
            id: block.id,
            name: nameBySkill.get(block.id) || "",
            desc: descPlain,
            descRaw: desc,
            // 描述文本在哪改（文件 + 行号）
            descFile: pos ? pos.file : null,
            descLine: pos ? pos.line : null,
            source,
            pack,
            file: rel,
            line: block.startLine,
            endLine: block.endLine,
            // 该技能属于哪些武将（反查改动影响面）
            owners: ownersBySkill.get(block.id) || [],
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
const withDescPos = skills.filter(s => s.descFile).length;
const withOwners = skills.filter(s => s.owners.length).length;
console.log(`描述可定位: ${withDescPos} / ${skills.length}，可反查所属武将: ${withOwners} / ${skills.length}`);

const index = {
    builtAt: new Date().toISOString(),
    root: ROOT,
    counts: { total: skills.length, withDesc, bySource, withDescPos, withOwners, characters: characters.length },
    characters,
    skills,
};
writeFileSync(OUT, JSON.stringify(index, null, 0), "utf8");
console.log(`索引已写入: ${OUT} (${(JSON.stringify(index).length / 1024 / 1024).toFixed(2)} MB)`);
