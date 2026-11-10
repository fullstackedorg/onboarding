// A few real lines of the project being bundled where Node.js and browser
// APIs meet in one file, shown while esbuild runs. Read from the copy that
// was just downloaded, never from a copy in this repository.

import fs from "fs";
import { listFiles } from "./files";

export type Api = "node" | "browser";
export type ExcerptLine =
    { kind: "line"; n: number; text: string; api: Api } | { kind: "gap" };
export type Excerpt = { file: string; lines: ExcerptLine[] };

// the demo's file that shows it best; any other project file works too
const PREFERRED = ["src/build-stats.ts"];
const SOURCE = /\.(tsx?|jsx?)$/;
const NODE_IMPORT =
    /^import .+ from "(node:)?(fs|os|path|crypto|net|zlib|dns)(\/[a-z]+)?";?$/;
const NODE_CALL = /\b(fs|os|path|crypto|net|zlib|dns)\.[a-zA-Z]+/;
const BROWSER =
    /\b(document|window|location|navigator|localStorage)\.[a-zA-Z]+/;
const MAX = 42;

// the expression around the API, so a line fits on a phone; … marks the rest
function cut(text: string, token: RegExp): string {
    if (text.length <= MAX) return text;
    const at = Math.max(0, text.search(token));
    let start = at;
    // back to the start of the expression: "await …", "new …", or after "(" / "= "
    const before = text.slice(Math.max(0, at - 24), at);
    const m = before.match(/(?:await |new [\w.]+\()$/);
    if (at <= 18) start = 0;
    else if (m) start = at - m[0].length;
    const end = Math.min(text.length, start + MAX);
    return (
        (start > 0 ? "…" : "") +
        text.slice(start, end) +
        (end < text.length ? "…" : "")
    );
}

export function pickLines(source: string): ExcerptLine[] {
    const lines = source.split("\n").map((l) => l.trim());
    const found: { n: number; text: string; api: Api }[] = [];
    const take = (match: RegExp, api: Api, limit: number) => {
        let taken = 0;
        lines.forEach((l, i) => {
            if (taken >= limit || l.startsWith("//") || l.startsWith("*"))
                return;
            if (!match.test(l) || found.some((f) => f.n === i + 1)) return;
            found.push({ n: i + 1, text: cut(l, match), api });
            taken++;
        });
        return taken;
    };
    if (!take(NODE_IMPORT, "node", 1)) return [];
    if (!take(NODE_CALL, "node", 2)) return [];
    if (!take(BROWSER, "browser", 1)) return [];
    found.sort((a, b) => a.n - b.n);
    const out: ExcerptLine[] = [];
    found.forEach((f, i) => {
        if (i > 0 && f.n > found[i - 1].n + 1) out.push({ kind: "gap" });
        out.push({ kind: "line", ...f });
    });
    return out;
}

export async function findExcerpt(dir: string): Promise<Excerpt | null> {
    let files: string[] = [];
    try {
        files = (await listFiles(dir)).filter((f) => SOURCE.test(f));
    } catch {
        return null;
    }
    files.sort(
        (a, b) =>
            (PREFERRED.includes(b) ? 1 : 0) - (PREFERRED.includes(a) ? 1 : 0)
    );
    for (const file of files) {
        try {
            const lines = pickLines(
                await fs.promises.readFile(`${dir}/${file}`, {
                    encoding: "utf8"
                })
            );
            if (lines.length) return { file, lines };
        } catch {}
    }
    return null;
}
