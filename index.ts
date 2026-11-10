// The build plugin that adds the onboarding to the FullStacked app's shell:
//
//   fullstacked --build -p <path to this repository> shell
//
// (The CLI bundles a plugin given as a directory from its index.ts: this file.
// The standalone development page is dev/index.ts.)
//
// The shell imports "./auto" (shell/auto.ts), an empty module kept as a hook
// for build plugins. This plugin intercepts that import and adds two files
// to shell/out:
//
//   onboarding.js   a small loader, linked from index.html after the shell's
//                   bundle. It tells the shell to hold its terminal, waits for
//                   the shell's runtime, then imports onboarding.mjs.
//   onboarding.mjs  src/shell.ts bundled with bundleFile: the onboarding, then
//                   the terminal. Not linked from index.html (only .js files
//                   are), so it runs once the shell's runtime is ready.
//
// Another shell plugin can reuse this with its own startup module, which
// imports startOnboarding from src/index.ts:
//
//   import { shellStartupPlugin } from "<onboarding>/index.ts";
//   export default shellStartupPlugin(new URL("./startup.ts", import.meta.url), "startup");
//
// Only one plugin can intercept "./auto" in a build.

import { bundleFile } from "fullstacked/bundle";
import fs from "fs";
import path from "path";

// the module's path for the core: relative to the working directory
function projectPath(url: URL) {
    let file = decodeURIComponent(url.pathname);
    // file:///C:/… on Windows
    if (/^\/[A-Za-z]:\//.test(file)) file = file.slice(1);
    return path.relative(process.cwd(), file) || ".";
}

function loader(module: string) {
    return `// Added by the onboarding build plugin (github.com/fullstackedorg/onboarding)
const startup = (globalThis.fullstackedShell ??= {});
// the shell doesn't open its terminal while a startup script holds it
startup.held = true;
await new Promise((resolve) => {
    if (startup.openTerminal) resolve();
    else globalThis.addEventListener("fullstackedshell", resolve, { once: true });
});
try {
    const { default: start } = await import(${JSON.stringify(module)});
    await start(startup);
} catch (e) {
    console.error("startup:", e);
    startup.openTerminal();
}
`;
}

export function shellStartupPlugin(entry: URL, name = "onboarding") {
    return {
        data: {
            name,
            // the shell's `import "./auto"`
            filter: "^\\./auto$",
            ext: ["ts"]
        },
        async callback() {
            const entryPath = projectPath(entry);
            const result = await bundleFile(entryPath);
            if (result.Errors?.length) {
                throw new Error(
                    result.Errors.map(
                        (e) =>
                            `${e.Location?.File ?? entryPath}:${e.Location?.Line ?? 0}: ${e.Text}`
                    ).join("\n")
                );
            }
            const output = entryPath + ".js";
            const contents = new Uint8Array(await fs.promises.readFile(output));
            await fs.promises.rm(output);
            return [
                { outputName: `${name}.js`, contents: loader(`./${name}.mjs`) },
                { outputName: `${name}.mjs`, contents }
            ];
        }
    };
}

export default shellStartupPlugin(new URL("./src/shell.ts", import.meta.url));
