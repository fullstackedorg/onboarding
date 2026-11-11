// The live build of the demo: download it with git, install its packages,
// bundle it. Everything runs in the runtime of this page, on this device.

import git from "fullstacked/git";
import packages from "fullstacked/packages";
import fullstacked from "fullstacked";
import fs from "fs";
import { DEMO_COMMIT, DEMO_DOWNLOAD, DEMO_REPOSITORY } from "./demo-pin";
import { listFiles } from "./files";
import { runtimeInfo, type RuntimeInfo } from "./runtime-info";
import { formatBytes, plural, stripAnsi } from "./format";

export type StepId = "download" | "install" | "bundle";

export const STEPS: { id: StepId; label: string }[] = [
    { id: "download", label: "Download from GitHub with git" },
    { id: "install", label: "Install the npm packages" },
    { id: "bundle", label: "Bundle with esbuild" }
];

// Where a step is, for its progress bar
export type StepProgress = {
    // 0 to 1; undefined while nothing can be measured (esbuild gives no progress)
    fraction?: number;
    // what it is doing now: "Receiving objects", "+ react 19.3.1"…
    status: string;
    // the numbers so far: "1.3 MB / 2.3 MB · 2.1 MB/s", "3 / 8 packages"…
    counts?: string;
};

export type BuildCallbacks = {
    // where the demo goes, once chosen (demo, or demo-2… when demo is taken)
    onTarget?(dir: string): void;
    // the step started
    onStep(step: StepId): void;
    // the step moved
    onProgress(step: StepId, progress: StepProgress): void;
    // the step finished, with a short summary
    onStepDone(step: StepId, summary: string): void;
    // raw output, for the log
    onLog(line: string): void;
    // The bundle runs on this page's thread (the plugins compile in it):
    // resolves when it may start, so it doesn't stutter an animation on
    // screen. The wait isn't counted in the build's times.
    beforeBundle?(): Promise<void>;
};

// Written to <dir>/user_data/build.json for the demo's walkthrough
export type BuildReport = {
    version: 1;
    builtAt: string;
    directory: string; // where the demo was built, from the projects folder
    repository: string;
    commit: string;
    runtime: RuntimeInfo;
    git: {
        objects: number;
        bytes: number; // size of the packs on disk
        downloaded: boolean; // false when an earlier clone was reused
        files: number; // files in the working tree, without node_modules and out
    };
    packages: {
        count: number; // in package-lock.json
        downloaded: number; // fetched by this install (0 when all were there)
        bytes: number; // estimate: the tarballs' size, measured when the demo was pinned
    };
    bundle: {
        sourceFiles: number; // .ts, .tsx, .js, .jsx and .css files of the project
        bytes: number; // out/, all files
        outputs: { name: string; bytes: number }[];
    };
    downloadedBytes: number; // git + packages, 0 when nothing was downloaded
    seconds: {
        download: number;
        install: number;
        bundle: number;
        total: number;
    };
};

export class StepError extends Error {
    step: StepId;
    constructor(step: StepId, message: string) {
        super(message);
        this.step = step;
    }
}

// one sentence for the failure screen
function firstLine(e: unknown) {
    const text = stripAnsi(
        (e as any)?.message ?? (typeof e === "string" ? e : String(e))
    ).trim();
    return text.split("\n")[0] || "Unknown error";
}

const now = () => performance.now();

// Reads a git progress stream: \r rewrites the current line, \n ends it
async function consumeProgress(
    duplexPromise: ReturnType<typeof git.clone>,
    onLine: (line: string, final: boolean) => void
) {
    const duplex = await duplexPromise;
    const decoder = new TextDecoder();
    let buffer = "";
    for await (const chunk of duplex as AsyncIterable<Uint8Array | string>) {
        buffer +=
            typeof chunk === "string"
                ? chunk
                : decoder.decode(chunk, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop();
        for (const line of lines) {
            const text = line
                .split("\r")
                .filter((s) => s.trim())
                .pop();
            if (text) onLine(text.trim(), true);
        }
        const current = buffer
            .split("\r")
            .filter((s) => s.trim())
            .pop();
        if (current) onLine(current.trim(), false);
    }
    const rest = buffer
        .split("\r")
        .filter((s) => s.trim())
        .pop();
    if (rest) onLine(rest.trim(), true);
}

function normalizeRepo(url: string) {
    return url
        .trim()
        .toLowerCase()
        .replace(/\/+$/, "")
        .replace(/\.git$/, "");
}

async function originUrl(dir: string): Promise<string | null> {
    try {
        const config = await fs.promises.readFile(`${dir}/.git/config`, {
            encoding: "utf8"
        });
        const section = config.split(/\[remote "origin"\]/)[1] ?? "";
        const match = section.split(/\n\s*\[/)[0].match(/url\s*=\s*(.+)/);
        return match?.[1].trim() ?? null;
    } catch {
        return null;
    }
}

async function exists(path: string) {
    try {
        await fs.promises.stat(path);
        return true;
    } catch {
        return false;
    }
}

export type DemoTarget = { dir: string; reuse: boolean };

// The demo goes to <cloneDir>. When that folder holds something else, the
// next free <cloneDir>-2, <cloneDir>-3… so nothing of the user's is touched.
export async function demoTarget(cloneDir: string): Promise<DemoTarget> {
    const name = cloneDir.replace(/^\/+|\/+$/g, "");
    if (!name || name.split("/").some((part) => part === ".." || part === "."))
        throw new Error(`"${cloneDir}" is not a folder of the projects folder`);
    const base = "/" + name;
    for (let i = 1; i < 100; i++) {
        const dir = i === 1 ? base : `${base}-${i}`;
        if (!(await exists(dir))) return { dir, reuse: false };
        const origin = await originUrl(dir);
        if (origin && normalizeRepo(origin) === normalizeRepo(DEMO_REPOSITORY))
            return { dir, reuse: true };
    }
    throw new Error(`no free folder for the demo next to ${base}`);
}

// git's objects on disk, while they arrive: the pack is written as it downloads
async function objectBytes(dir: string): Promise<number> {
    let bytes = 0;
    try {
        for (const entry of await fs.promises.readdir(dir, {
            withFileTypes: true
        })) {
            const path = `${dir}/${entry.name}`;
            bytes += entry.isDirectory()
                ? await objectBytes(path)
                : (await fs.promises.stat(path)).size;
        }
    } catch {}
    return bytes;
}

async function packBytes(dir: string) {
    const packDir = `${dir}/.git/objects/pack`;
    let bytes = 0;
    try {
        for (const name of await fs.promises.readdir(packDir)) {
            if (!name.endsWith(".pack")) continue;
            bytes += (await fs.promises.stat(`${packDir}/${name}`)).size;
        }
    } catch {}
    return bytes;
}

async function download(target: DemoTarget, cb: BuildCallbacks) {
    const { dir } = target;
    const expected = DEMO_DOWNLOAD.gitBytes;
    let objects = 0;
    // 0–15 %: the server counts and compresses; 15–90 %: the pack arrives
    // (measured on disk); 90–100 %: checkout
    let fraction = 0;
    let receiving = false;
    const progress = (p: StepProgress) => {
        fraction = Math.max(fraction, p.fraction ?? fraction);
        cb.onProgress("download", { ...p, fraction });
    };
    const onLine = (line: string, final: boolean) => {
        // "Total 465 (delta 230)…", "Enumerating objects: 465, done."
        const total =
            line.match(/Total (\d+)/) ??
            line.match(/Enumerating objects: (\d+)/) ??
            line.match(/Counting objects: +\d+% \(\d+\/(\d+)/);
        if (total) objects = Math.max(objects, Number(total[1]));
        const phase = line.match(
            /^(Enumerating|Counting|Compressing) objects:\s*(?:(\d+)%)?/
        );
        if (phase && !receiving) {
            const pct = Number(phase[2] ?? 100) / 100;
            progress({
                fraction:
                    phase[1] === "Compressing" ? 0.08 + 0.07 * pct : 0.08 * pct,
                status: `${phase[1]} objects on GitHub`,
                counts: objects ? `${objects} objects` : undefined
            });
        }
        if (final) cb.onLog(line);
    };

    // the pack, as it is written
    let last = { bytes: 0, at: now() };
    let speed = 0;
    let polling = true;
    const poll = (async () => {
        while (polling) {
            await new Promise((r) => setTimeout(r, 150));
            if (!polling) break;
            const bytes = await objectBytes(`${dir}/.git/objects`);
            if (bytes <= last.bytes) continue;
            const at = now();
            speed = ((bytes - last.bytes) / (at - last.at)) * 1000;
            last = { bytes, at };
            receiving = true;
            progress({
                fraction: 0.15 + 0.75 * Math.min(1, bytes / expected),
                status: "Receiving objects",
                counts: `${formatBytes(bytes)} / ${formatBytes(expected)} · ${formatBytes(speed)}/s`
            });
        }
    })();

    try {
        if (target.reuse) {
            // a replay: drop the demo's own edits (its walkthrough rewrites a
            // file), then move to the pinned commit, fetching only if needed
            progress({
                fraction: 0.5,
                status: "Already downloaded: updating it"
            });
            cb.onLog(`$ git reset --hard (${dir})`);
            await git.reset(dir, true);
            try {
                cb.onLog(`$ git checkout ${DEMO_COMMIT.slice(0, 7)}`);
                await consumeProgress(git.checkout(dir, DEMO_COMMIT), onLine);
            } catch {
                cb.onLog(`$ git fetch`);
                await consumeProgress(git.fetch(dir), onLine);
                await consumeProgress(git.checkout(dir, DEMO_COMMIT), onLine);
            }
        } else {
            progress({ fraction: 0, status: "Connecting to github.com" });
            cb.onLog(`$ git clone ${DEMO_REPOSITORY} ${dir}`);
            await consumeProgress(git.clone(DEMO_REPOSITORY, dir), onLine);
            polling = false;
            await poll;
            progress({
                fraction: 0.9,
                status: `Checking out ${DEMO_COMMIT.slice(0, 7)}`,
                counts: `${objects || DEMO_DOWNLOAD.gitObjects} objects · ${formatBytes(await packBytes(dir))}`
            });
            cb.onLog(`$ git checkout ${DEMO_COMMIT.slice(0, 7)}`);
            await consumeProgress(git.checkout(dir, DEMO_COMMIT), onLine);
        }
    } finally {
        polling = false;
        await poll;
    }

    const files = (await listFiles(dir)).length;
    return {
        objects: objects || DEMO_DOWNLOAD.gitObjects,
        bytes: await packBytes(dir),
        downloaded: !target.reuse,
        files
    };
}

async function install(dir: string, cb: BuildCallbacks) {
    let count = 0;
    try {
        const lock = JSON.parse(
            await fs.promises.readFile(`${dir}/package-lock.json`, {
                encoding: "utf8"
            })
        );
        count = Object.keys(lock.packages ?? {}).filter(Boolean).length;
    } catch {}

    cb.onLog(`$ npm install (${dir})`);
    const emitter = await packages.install(dir, false);
    let downloaded = 0;
    let error = "";
    const extracted = new Set<string>();
    // 0–10 %: lockfile and resolution; 10–95 %: the packages, one after the
    // other; 95–100 %: lockfiles
    const total = count || DEMO_DOWNLOAD.packages || 1;
    const counts = (share: number) =>
        `${Math.min(extracted.size, total)} / ${total} packages · ${formatBytes(DEMO_DOWNLOAD.packagesBytes * Math.min(1, share))} / ${formatBytes(DEMO_DOWNLOAD.packagesBytes)}`;
    cb.onProgress("install", {
        fraction: 0,
        status: "Reading package-lock.json",
        counts: counts(0)
    });
    emitter.on("progress", (...events: any[]) => {
        for (const p of events.flat()) {
            switch (p?.stage) {
                case "Verifying Lockfile":
                    cb.onProgress("install", {
                        fraction: 0.03,
                        status: "Verifying package-lock.json",
                        counts: counts(0)
                    });
                    break;
                case "Resolving":
                    cb.onProgress("install", {
                        fraction: 0.08,
                        status: "Resolving packages on registry.npmjs.org",
                        counts: counts(0)
                    });
                    break;
                case "Extracting": {
                    const pct = Math.min(1, p.progress ?? 0);
                    if (pct >= 1 && !extracted.has(p.name)) {
                        extracted.add(p.name);
                        cb.onLog(`+ ${p.name}@${p.version}`);
                    }
                    const share = Math.min(
                        1,
                        (extracted.size + (extracted.has(p.name) ? 0 : pct)) /
                            total
                    );
                    cb.onProgress("install", {
                        fraction: 0.1 + 0.85 * share,
                        status: `+ ${p.name} ${p.version}`,
                        counts: counts(share)
                    });
                    break;
                }
                case "Finalizing":
                    cb.onProgress("install", {
                        fraction: 0.97,
                        status: "Writing the lockfiles",
                        counts: counts(1)
                    });
                    break;
                case "Done":
                    downloaded = p.progress ?? 0;
                    cb.onLog(
                        `Done: ${plural(downloaded, "package")} downloaded`
                    );
                    break;
                case "Error":
                    error = p.error ?? "install failed";
                    cb.onLog(`Error: ${error}`);
                    break;
            }
        }
    });
    await emitter.duplex.promise();
    if (error) throw new Error(error);

    return {
        count,
        downloaded,
        bytes:
            count && downloaded
                ? Math.round(
                      (DEMO_DOWNLOAD.packagesBytes *
                          Math.min(downloaded, count)) /
                          count
                  )
                : 0
    };
}

const SOURCE_EXT = /\.(tsx?|jsx?|css)$/;

// esbuild gives no progress: a step that never ends (a plugin that never
// answers) fails after this
const BUNDLE_TIMEOUT_MS = 3 * 60 * 1000;

async function bundle(dir: string, cb: BuildCallbacks) {
    // from the demo's folder, like its `npm start`: build plugins look for
    // their files from the working directory
    const command = [
        "fullstacked",
        "--build",
        "-p",
        "@fullstacked/tailwindcss",
        "."
    ];
    cb.onLog(`$ cd ${dir} && ${command.join(" ")}`);
    const sources = (await listFiles(dir)).filter((f) => SOURCE_EXT.test(f));
    cb.onProgress("bundle", {
        status: "TypeScript, JSX and CSS, with esbuild",
        counts: `${plural(sources.length, "source file")} → out/`
    });
    const errors: string[] = [];
    const writer = (isError: boolean) => {
        const write = (msg: unknown) => {
            for (const line of stripAnsi(String(msg)).split("\n")) {
                if (!line.trim()) continue;
                cb.onLog(line);
                if (isError && /error/i.test(line)) errors.push(line.trim());
            }
        };
        return { write, writeln: write };
    };

    const cwd = process.cwd();
    process.chdir(dir);
    let timeout: ReturnType<typeof setTimeout>;
    let code: number;
    try {
        code = await Promise.race([
            fullstacked.execute(command, {
                stdio: [null, writer(false), writer(true)]
            }),
            new Promise<never>((_, reject) => {
                timeout = setTimeout(
                    () =>
                        reject(
                            new Error(
                                `no result after ${BUNDLE_TIMEOUT_MS / 60000} minutes`
                            )
                        ),
                    BUNDLE_TIMEOUT_MS
                );
            })
        ]);
    } finally {
        clearTimeout(timeout);
        process.chdir(cwd);
    }
    if (code !== 0) {
        throw new Error(errors[0] ?? "the bundle failed, see the log");
    }

    const outputs: { name: string; bytes: number }[] = [];
    for (const name of await fs.promises.readdir(`${dir}/out`)) {
        const stats = await fs.promises.stat(`${dir}/out/${name}`);
        if (stats.isFile()) outputs.push({ name, bytes: stats.size });
    }
    const sourceFiles = (await listFiles(dir)).filter((f) =>
        SOURCE_EXT.test(f)
    ).length;
    return {
        sourceFiles,
        bytes: outputs.reduce((sum, o) => sum + o.bytes, 0),
        outputs
    };
}

async function step<T>(
    id: StepId,
    cb: BuildCallbacks,
    run: () => Promise<T>
): Promise<[T, number]> {
    cb.onStep(id);
    const start = now();
    try {
        const result = await run();
        return [result, (now() - start) / 1000];
    } catch (e) {
        cb.onLog(`Error: ${stripAnsi(String((e as any)?.message ?? e))}`);
        throw new StepError(id, firstLine(e));
    }
}

export async function buildDemo(
    cloneDir: string,
    cb: BuildCallbacks
): Promise<BuildReport> {
    const start = now();
    const target = await demoTarget(cloneDir).catch((e) => {
        throw new StepError("download", firstLine(e));
    });
    const { dir } = target;
    cb.onTarget?.(dir);

    const [gitStats, tDownload] = await step("download", cb, () =>
        download(target, cb)
    );
    cb.onStepDone(
        "download",
        `${plural(gitStats.objects, "object")}, ${gitStats.downloaded ? formatBytes(gitStats.bytes) : "already downloaded"}`
    );

    const [npmStats, tInstall] = await step("install", cb, () =>
        install(dir, cb)
    );
    cb.onStepDone(
        "install",
        `${plural(npmStats.count, "package")}${npmStats.downloaded ? "" : ", already installed"}`
    );

    const holdStart = now();
    await cb.beforeBundle?.();
    const held = now() - holdStart;

    const [bundleStats, tBundle] = await step("bundle", cb, () =>
        bundle(dir, cb)
    );
    cb.onStepDone(
        "bundle",
        `${plural(bundleStats.sourceFiles, "file")} into ${formatBytes(bundleStats.bytes)}`
    );

    const report: BuildReport = {
        version: 1,
        builtAt: new Date().toISOString(),
        directory: dir.slice(1),
        repository: DEMO_REPOSITORY,
        commit: DEMO_COMMIT,
        runtime: runtimeInfo(),
        git: gitStats,
        packages: npmStats,
        bundle: bundleStats,
        downloadedBytes:
            (gitStats.downloaded ? gitStats.bytes : 0) + npmStats.bytes,
        seconds: {
            download: round(tDownload),
            install: round(tInstall),
            bundle: round(tBundle),
            total: round((now() - start - held) / 1000)
        }
    };

    // for the demo's walkthrough, before it is opened
    try {
        await fs.promises.mkdir(`${dir}/user_data`, { recursive: true });
        await fs.promises.writeFile(
            `${dir}/user_data/build.json`,
            JSON.stringify(report, null, 2)
        );
        cb.onLog(`Wrote ${dir}/user_data/build.json`);
    } catch (e) {
        cb.onLog(`Could not write build.json: ${firstLine(e)}`);
    }

    return report;
}

const round = (s: number) => Math.round(s * 10) / 10;

// A quick check before offering the build: git's HEAD request would fail
// fast too, but the welcome screen should know before the user taps.
export async function canReachDemo(timeoutMs = 6000): Promise<boolean> {
    if (typeof navigator !== "undefined" && navigator.onLine === false)
        return false;
    const url =
        DEMO_REPOSITORY.replace(/\.git$/, "") +
        ".git/info/refs?service=git-upload-pack";
    try {
        await Promise.race([
            fetch(url, { method: "HEAD" }),
            new Promise((_, reject) =>
                setTimeout(() => reject(new Error("timeout")), timeoutMs)
            )
        ]);
        return true;
    } catch {
        return false;
    }
}
