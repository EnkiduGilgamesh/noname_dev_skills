#!/usr/bin/env node
/**
 * 技能知识库模块
 *
 * 设计目标：让检索结论可沉淀、可复用，同时**不会因源码变动而误导**。
 *
 * 核心机制 —— 证据指纹（fingerprint）：
 *   每条知识记录其依据的源码位置（文件:行号）与该处的**内容哈希**。
 *   读取知识时重新计算哈希：
 *     - 一致  → 知识有效（fresh）
 *     - 不一致 → 源码已变动（stale），标记失效并回退到索引检索
 *     - 文件不存在 → 失效（missing）
 *
 * 知识条目分类：
 *   · pattern  —— 写法结论（如"判定用 judge().forResult()"）
 *   · pitfall  —— 坑点（如"限定技必须 awakenSkill"）
 *   · recipe   —— 需求→推荐技能（缓存检索结果，带指纹）
 *   · fact     —— 项目事实（如"扩展内 name 会被覆盖"）
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, dirname, relative } from "node:path";

// ── 指纹计算 ───────────────────────────────────────────────

/** 计算某段文本的哈希（前 12 位） */
export function hashText(text) {
    return createHash("sha256").update(text).digest("hex").slice(0, 12);
}

/**
 * 为「文件 + 行范围」生成指纹
 * @returns {{file:string,start:number,end:number,hash:string}|null}
 */
export function makeFingerprint(root, file, start, end) {
    const abs = join(root, file);
    if (!existsSync(abs)) return null;
    try {
        const lines = readFileSync(abs, "utf8").split(/\r?\n/);
        const slice = lines.slice(start - 1, end).join("\n");
        if (!slice.trim()) return null;
        return { file, start, end, hash: hashText(slice.trim()) };
    } catch {
        return null;
    }
}

/**
 * 校验指纹
 * @returns {"fresh"|"stale"|"missing"}
 */
export function verifyFingerprint(root, fp) {
    if (!fp) return "missing";
    const abs = join(root, fp.file);
    if (!existsSync(abs)) return "missing";
    try {
        const lines = readFileSync(abs, "utf8").split(/\r?\n/);
        if (fp.start > lines.length) return "stale";
        const slice = lines.slice(fp.start - 1, fp.end).join("\n");
        if (!slice.trim()) return "stale";
        return hashText(slice.trim()) === fp.hash ? "fresh" : "stale";
    } catch {
        return "missing";
    }
}

// ── 知识库读写 ─────────────────────────────────────────────

export class KnowledgeBase {
    /**
     * @param {string} path 知识库 JSON 路径
     * @param {string} root 项目根（用于指纹校验）
     */
    constructor(path, root) {
        this.path = path;
        this.root = root;
        this.data = this.#load();
    }

    #load() {
        if (!existsSync(this.path)) {
            return { version: 1, updatedAt: null, entries: [] };
        }
        try {
            const raw = JSON.parse(readFileSync(this.path, "utf8"));
            if (!Array.isArray(raw.entries)) raw.entries = [];
            return raw;
        } catch {
            // 损坏时不静默丢弃，备份后重建
            try {
                const bak = `${this.path}.corrupt-${Date.now()}`;
                writeFileSync(bak, readFileSync(this.path));
                console.error(`⚠ 知识库损坏，已备份至 ${bak}`);
            } catch { /* ignore */ }
            return { version: 1, updatedAt: null, entries: [] };
        }
    }

    save() {
        this.data.updatedAt = new Date().toISOString();
        mkdirSync(dirname(this.path), { recursive: true });
        writeFileSync(this.path, JSON.stringify(this.data, null, 2), "utf8");
    }

    get entries() {
        return this.data.entries;
    }

    /** 列出全部条目并校验状态 */
    list() {
        return this.data.entries.map(e => ({
            ...e,
            status: this.#statusOf(e),
        }));
    }

    #statusOf(entry) {
        if (!entry.fingerprints || entry.fingerprints.length === 0) {
            // 无源码依据的结论（如经验性 pitfall）视为长期有效
            return "fresh";
        }
        const results = entry.fingerprints.map(fp => verifyFingerprint(this.root, fp));
        if (results.includes("missing")) return "missing";
        if (results.includes("stale")) return "stale";
        return "fresh";
    }

    /** 按 id 取条目（含状态） */
    get(id) {
        const e = this.data.entries.find(x => x.id === id);
        return e ? { ...e, status: this.#statusOf(e) } : null;
    }

    /**
     * 写入/更新一条知识
     * 相同 id 则覆盖（保留 createdAt）
     */
    put(entry) {
        const now = new Date().toISOString();
        const idx = this.data.entries.findIndex(e => e.id === entry.id);
        const record = {
            id: entry.id,
            kind: entry.kind || "fact",
            title: entry.title || "",
            body: entry.body || "",
            keywords: entry.keywords || [],
            refs: entry.refs || [],
            fingerprints: entry.fingerprints || [],
            confidence: entry.confidence || "verified",
            createdAt: idx >= 0 ? this.data.entries[idx].createdAt : now,
            updatedAt: now,
        };
        if (idx >= 0) this.data.entries[idx] = record;
        else this.data.entries.push(record);
        return record;
    }

    /** 删除条目 */
    remove(id) {
        const before = this.data.entries.length;
        this.data.entries = this.data.entries.filter(e => e.id !== id);
        return before !== this.data.entries.length;
    }

    /**
     * 按关键词检索知识（不校验指纹，由调用方决定）
     * @returns 按相关度排序的条目
     */
    match(query, limit = 5) {
        const tokens = tokenize(query);
        const scored = this.data.entries
            .map(e => {
                const hay = [e.title, e.body, ...(e.keywords || [])].join(" ").toLowerCase();
                let v = 0;
                for (const t of tokens) {
                    if (!t) continue;
                    const w = t.length >= 3 ? 3 : t.length === 2 ? 2 : 1;
                    if (hay.includes(t)) v += w;
                }
                return { e, v };
            })
            .filter(x => x.v > 0)
            .sort((a, b) => b.v - a.v)
            .slice(0, limit);
        return scored.map(x => ({ ...x.e, status: this.#statusOf(x.e), _score: x.v }));
    }

    /** 统计 */
    stats() {
        const all = this.list();
        const byKind = {};
        const byStatus = {};
        for (const e of all) {
            byKind[e.kind] = (byKind[e.kind] || 0) + 1;
            byStatus[e.status] = (byStatus[e.status] || 0) + 1;
        }
        return {
            total: all.length,
            byKind,
            byStatus,
            updatedAt: this.data.updatedAt,
            path: this.path,
        };
    }
}

// ── 检索分词（与 skill-search 保持一致）────────────────────

const SYNONYMS = {
    摸牌: ["draw"], 弃牌: ["discard"], 伤害: ["damage"], 回复: ["recover"],
    体力: ["hp"], 判定: ["judge"], 濒死: ["dying"], 死亡: ["die"],
    锁定技: ["forced"], 限定技: ["limited"], 视为: ["viewAs"], 主动技: ["enable"],
};

export function tokenize(q) {
    const tokens = new Set();
    for (const w of q.toLowerCase().match(/[a-z][a-z0-9_]*/g) || []) tokens.add(w);
    const cn = q.match(/[\u4e00-\u9fa5]+/g) || [];
    for (const seg of cn) {
        for (let n = 4; n >= 2; n--) {
            for (let i = 0; i + n <= seg.length; i++) tokens.add(seg.slice(i, i + n));
        }
        for (const ch of seg) tokens.add(ch);
    }
    for (const t of [...tokens]) {
        for (const [key, syns] of Object.entries(SYNONYMS)) {
            if (t === key || key.includes(t) || t.includes(key)) {
                for (const s of syns) tokens.add(s.toLowerCase());
            }
        }
    }
    return [...tokens];
}
