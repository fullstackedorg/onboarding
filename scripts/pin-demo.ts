// Pins the demo the onboarding builds, from the vendor/demo submodule.
//
//   npm run pin-demo              regenerate src/demo-pin.ts from the commit
//                                 recorded for vendor/demo (after a pull, a
//                                 merge, or `git submodule update`)
//   npm run pin-demo -- <ref>     move vendor/demo to <ref> (a branch, tag or
//                                 commit of the demo), stage it, regenerate
//   npm run pin-demo -- --check   exit 1 when src/demo-pin.ts doesn't match
//                                 the submodule (for CI)
//
// The onboarding clones the demo from GitHub at runtime, then checks out
// DEMO_COMMIT, so a change on the demo's main never reaches users until it is
// pinned here. src/demo-pin.ts is committed: building the onboarding needs
// neither git nor Node, only the runtime.
//
// Runs on Node 22.18+ (type stripping), with the git command line.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const submodule = "vendor/demo";
const pinFile = path.join(root, "src", "demo-pin.ts");

function git(args: string[], cwd = root, input?: Buffer): string {
    return execFileSync("git", args, {
        cwd,
        input,
        encoding: "utf8",
        maxBuffer: 256 * 1024 * 1024,
        stdio: [input ? "pipe" : "ignore", "pipe", "inherit"]
    }).trim();
}

function gitBytes(args: string[], cwd: string, input?: string): number {
    const out = execFileSync("git", args, {
        cwd,
        input,
        maxBuffer: 256 * 1024 * 1024,
        stdio: ["pipe", "pipe", "inherit"]
    });
    return out.byteLength;
}

// the commit the superproject records for the submodule (index, then HEAD)
function recordedCommit(): string {
    const line = git(["ls-files", "--stage", "--", submodule]);
    const match = line.match(/^160000 ([0-9a-f]{40}) /);
    if (!match) {
        throw new Error(`${submodule} is not a submodule of this repository`);
    }
    return match[1];
}

function repositoryUrl(): string {
    return git([
        "config",
        "--file",
        ".gitmodules",
        `submodule.${submodule}.url`
    ]);
}

function readPinnedCommit(): string | null {
    if (!fs.existsSync(pinFile)) return null;
    const match = fs
        .readFileSync(pinFile, "utf8")
        .match(/DEMO_COMMIT = "([0-9a-f]{40})"/);
    return match?.[1] ?? null;
}

// sum of the tarballs package-lock.json points to, for the welcome screen
async function packagesDownload(lockfile: any) {
    const entries = Object.entries<any>(lockfile.packages || {}).filter(
        ([key, value]) => key && value.resolved
    );
    let bytes = 0;
    let unknown = 0;
    // the project's own dependencies (not nested ones), for the animation
    const list: { name: string; bytes: number }[] = [];
    await Promise.all(
        entries.map(async ([key, value]) => {
            try {
                // the registry sends no content-length to HEAD: ask for one
                // byte and read the total from content-range
                const res = await fetch(value.resolved, {
                    headers: { Range: "bytes=0-0" }
                });
                await res.arrayBuffer();
                const total = Number(
                    res.headers.get("content-range")?.split("/")[1] ??
                        res.headers.get("content-length")
                );
                if (res.ok && total > 0) bytes += total;
                else unknown++;
                const name = key.replace(/^node_modules\//, "");
                if (!value.dev && !name.includes("node_modules/"))
                    list.push({ name, bytes: total > 0 ? total : 0 });
            } catch {
                unknown++;
            }
        })
    );
    if (unknown) {
        console.warn(
            `pin-demo: no size for ${unknown} of ${entries.length} packages, the download size is underestimated`
        );
    }
    list.sort((a, b) => b.bytes - a.bytes || a.name.localeCompare(b.name));
    return { packages: entries.length, bytes, list };
}

async function writePin(commit: string) {
    const dir = path.join(root, submodule);
    const url = repositoryUrl();

    // what a clone of the default branch downloads: the pack of every object
    // reachable from the pinned commit (close enough when the pin is main)
    const objects = git(["rev-list", "--objects", commit], dir);
    const gitObjects = objects.split("\n").filter(Boolean).length;
    const gitBytes_ = gitBytes(
        ["pack-objects", "--stdout", "-q"],
        dir,
        objects + "\n"
    );
    const files = git(["ls-tree", "-r", "--name-only", commit], dir)
        .split("\n")
        .filter(Boolean).length;

    const lockfile = JSON.parse(
        git(["show", `${commit}:package-lock.json`], dir)
    );
    const npm = await packagesDownload(lockfile);

    const reachable = git(
        ["branch", "--remotes", "--contains", commit],
        dir
    ).trim();
    const tagged = git(["tag", "--contains", commit], dir).trim();
    if (!reachable && !tagged) {
        console.warn(
            `pin-demo: ${commit} is on no remote branch or tag: the runtime clone won't find it`
        );
    }

    const contents = `// Generated by \`npm run pin-demo\` from the ${submodule} submodule. Don't edit.
// The onboarding clones DEMO_REPOSITORY, then checks out DEMO_COMMIT.

export const DEMO_REPOSITORY = ${JSON.stringify(url)};
export const DEMO_COMMIT = ${JSON.stringify(commit)};

// What building the demo downloads at this commit, for the welcome screen
export const DEMO_DOWNLOAD = {
    gitObjects: ${gitObjects},
    gitBytes: ${gitBytes_},
    files: ${files},
    packages: ${npm.packages},
    packagesBytes: ${npm.bytes}
};

// Its dependencies, biggest download first: one cluster each in the animation
export const DEMO_PACKAGES: { name: string; bytes: number }[] = ${JSON.stringify(npm.list, null, 4).replace(/\n/g, "\n")};
`;
    fs.writeFileSync(pinFile, contents);
    console.log(
        `pin-demo: ${commit.slice(0, 7)} (${gitObjects} git objects, ${(gitBytes_ / 1e6).toFixed(1)} MB; ${npm.packages} packages, ${(npm.bytes / 1e6).toFixed(1)} MB) -> src/demo-pin.ts`
    );
}

const args = process.argv.slice(2);

// the submodule must be there to measure it
if (!fs.existsSync(path.join(root, submodule, ".git"))) {
    git(["submodule", "update", "--init", "--", submodule]);
}

if (args[0] === "--check") {
    const recorded = recordedCommit();
    const pinned = readPinnedCommit();
    if (recorded !== pinned) {
        console.error(
            `pin-demo: src/demo-pin.ts pins ${pinned?.slice(0, 7) ?? "nothing"}, ${submodule} is at ${recorded.slice(0, 7)}. Run npm run pin-demo.`
        );
        process.exit(1);
    }
    console.log(`pin-demo: ${recorded.slice(0, 7)}, in sync`);
} else if (args[0]) {
    const ref = args[0];
    const dir = path.join(root, submodule);
    git(["fetch", "--tags", "origin"], dir);
    let commit: string;
    try {
        commit = git(["rev-parse", "--verify", `origin/${ref}^{commit}`], dir);
    } catch {
        commit = git(["rev-parse", "--verify", `${ref}^{commit}`], dir);
    }
    git(["checkout", "--quiet", commit], dir);
    git(["add", "--", submodule]);
    await writePin(commit);
} else {
    await writePin(recordedCommit());
}
