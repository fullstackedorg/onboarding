import fs from "fs";

// what View source and the stats leave out: git's data, installed packages,
// build output and the demo's saved state
const IGNORED = new Set([".git", "node_modules", "out", "user_data"]);

export type Entry = { name: string; path: string; directory: boolean };

export async function listDirectory(dir: string): Promise<Entry[]> {
    const items = await fs.promises.readdir(dir, { withFileTypes: true });
    return items
        .filter((item) => !IGNORED.has(item.name))
        .map((item) => ({
            name: item.name,
            path: `${dir}/${item.name}`,
            directory: item.isDirectory()
        }))
        .sort((a, b) =>
            a.directory === b.directory
                ? a.name.localeCompare(b.name)
                : a.directory
                  ? -1
                  : 1
        );
}

// every file of the project, relative to dir
export async function listFiles(dir: string, prefix = ""): Promise<string[]> {
    const files: string[] = [];
    for (const entry of await listDirectory(dir)) {
        const rel = prefix + entry.name;
        if (entry.directory)
            files.push(...(await listFiles(entry.path, rel + "/")));
        else files.push(rel);
    }
    return files;
}

const MAX_PREVIEW = 512 * 1024;

export async function readPreview(
    path: string
): Promise<{ text: string } | { binary: number } | { tooLarge: number }> {
    const stats = await fs.promises.stat(path);
    if (stats.size > MAX_PREVIEW) return { tooLarge: stats.size };
    const data = (await fs.promises.readFile(path)) as Uint8Array;
    if (data.subarray(0, 8000).includes(0)) return { binary: stats.size };
    return { text: new TextDecoder().decode(data) };
}
