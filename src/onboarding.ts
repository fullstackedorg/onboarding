import config from "fullstacked/config";
import run from "fullstacked/run";
import {
    buildDemo,
    canReachDemo,
    STEPS,
    StepError,
    type BuildReport,
    type StepId,
    type StepProgress
} from "./build";
import { findExcerpt, type Excerpt } from "./excerpt";
import { DEMO_DOWNLOAD, DEMO_PACKAGES } from "./demo-pin";
import { listDirectory, readPreview } from "./files";
import { formatBytes } from "./format";
import { button, h, icon, type Child } from "./ui/dom";
import { css } from "./ui/styles";
import { createWorld, type World } from "./world/world";

export const ONBOARDING_CONFIG_KEY = "onboarding";

export type FooterLink = { label: string; href: string };

export type OnboardingStats = {
    // built: the demo was built; skipped: Skip; failed: Continue after a
    // failed step; offline: Continue without network
    outcome: "built" | "skipped" | "failed" | "offline";
    seconds: number; // time spent in the onboarding
    demoOpened: boolean;
    report?: BuildReport; // when built, also in <dir>/user_data/build.json
    error?: { step: StepId; message: string }; // when failed
};

export type OnboardingOptions = {
    // the hand-over, after `onboarding = "1"` is saved and the onboarding is
    // removed from the page
    onDone: (stats: OnboardingStats) => void | Promise<void>;
    // label of the button that calls onDone (default "Continue")
    continueLabel?: string;
    // where the demo is cloned, from the projects folder (default "demo")
    cloneDir?: string;
    // footer links (default: fullstacked.org, privacy, terms)
    links?: FooterLink[];
    // behave as if there was no network (development)
    offline?: boolean;
};

export type OnboardingHandle = {
    // the stats given to onDone, once it was called
    done: Promise<OnboardingStats>;
    // remove the onboarding without calling onDone
    unmount: () => void;
};

// Privacy and terms are placeholders until the final pages exist
export const DEFAULT_LINKS: FooterLink[] = [
    { label: "fullstacked.org", href: "https://fullstacked.org" },
    { label: "Privacy", href: "https://fullstacked.org/privacy" },
    { label: "Terms", href: "https://fullstacked.org/terms" }
];

// The FullStacked mark, monochrome (the app icon's paths)
const LOGO = `<svg viewBox="49 6.5 601 709" aria-hidden="true" fill="currentColor"><path d="M73.6316 550.363L358.404 715.202V378.205C358.404 365.062 365.385 352.902 376.758 346.331L637.136 195.618C650.745 187.748 650.745 168.034 637.136 160.124L382.994 13.1106C367.777 4.29613 349.069 4.29613 333.852 13.1106L67.3957 167.247C56.0221 173.818 49.0411 185.977 49.0411 199.16V507.628C49.0411 525.257 58.4145 541.549 73.6316 550.363Z"/><path d="M635.832 338.37L569.82 300.091L415.336 389.526V501.419L635.832 373.744C649.41 365.892 649.41 346.222 635.832 338.37Z"/><path d="M635.793 517.28L569.155 478.687L415.336 567.73V679.976L635.754 552.654C649.332 544.802 649.371 525.133 635.754 517.241L635.793 517.28Z"/></svg>`;

// FullStacked's blue: the world, the buttons, the glow
const WORLD_COLOR = "#219ef2";

// The words. One catchy, non-technical line per screen, no exact numbers:
// whole projects, built and run on this device.
const WORDS = {
    tagline: "Build anything. Run it everywhere.",
    what: "Whole projects, built and running right here. No server needed.",
    steps: {
        download: {
            name: "Download",
            big: "Pulling a real project onto this device.",
            small: ""
        },
        install: {
            name: "Install",
            big: "Gathering everything it needs to run.",
            small: ""
        },
        bundle: {
            name: "Build",
            big: "Putting it all together, right here.",
            small: ""
        }
    } as Record<StepId, { name: string; big: string; small: string }>,
    running: { name: "Run", big: "It's alive. No server, no cloud.", small: "" }
};

// true until the onboarding was finished once (`config delete onboarding`
// in the shell brings it back)
export async function shouldRunOnboarding(): Promise<boolean> {
    try {
        return (await config.get(ONBOARDING_CONFIG_KEY)) !== "1";
    } catch {
        return false;
    }
}

export async function markOnboardingDone() {
    await config.set(ONBOARDING_CONFIG_KEY, "1");
}

const STYLE_ID = "fso-style";

function injectStyles() {
    if (!document.getElementById(STYLE_ID)) {
        document.head.append(h("style", { id: STYLE_ID, text: css }));
    }
    // safe areas (env(safe-area-inset-*)) need viewport-fit=cover
    let meta = document.querySelector<HTMLMetaElement>('meta[name="viewport"]');
    if (!meta) {
        meta = h("meta", { name: "viewport" });
        meta.content = "width=device-width, initial-scale=1";
        document.head.append(meta);
    }
    if (!meta.content.includes("viewport-fit")) {
        meta.content += ", viewport-fit=cover";
    }
}

const reducedMotion = () =>
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

export function startOnboarding(
    el: HTMLElement,
    options: OnboardingOptions
): OnboardingHandle {
    const continueLabel = options.continueLabel ?? "Continue";
    const cloneDir = options.cloneDir ?? "demo";
    const links = options.links ?? DEFAULT_LINKS;
    const startedAt = performance.now();
    const reduced = reducedMotion();

    let finished = false;
    let demoOpened = false;
    let online: boolean | null = options.offline ? false : null;
    // a build left with Skip keeps running; its result is ignored
    let buildRun = 0;

    let resolveDone: (stats: OnboardingStats) => void;
    const done = new Promise<OnboardingStats>((r) => (resolveDone = r));

    injectStyles();

    // ── the stage: the world behind every screen ───────────────────────────
    const canvas = h("canvas", { class: "fso-canvas", "aria-hidden": "true" });
    const labels = h("div", { class: "fso-labels", "aria-hidden": "true" });
    const flashLayer = h("div", {
        class: "fso-flash-layer",
        "aria-hidden": "true"
    });
    const stage = h(
        "div",
        { class: "fso-stage" },
        h("div", { class: "fso-backdrop" }),
        canvas,
        h("div", { class: "fso-vignette" }),
        labels,
        flashLayer
    );

    const skip = button("Skip", () => finish({ outcome: "skipped" }), "text");
    const header = h(
        "header",
        { class: "fso-header" },
        h("div", {
            class: "fso-brand",
            role: "img",
            "aria-label": "FullStacked",
            html: LOGO
        }),
        skip
    );
    // the world fills the space above the words
    const sky = h("div", { class: "fso-sky" });
    const words = h("div", { class: "fso-words" });
    const main = h("main", { class: "fso-main" }, sky, words);
    const scroller = h("div", { class: "fso-scroll" }, main);
    // Back and Next: always at the bottom, in the same place
    const nav = h("nav", { class: "fso-nav", "aria-label": "Onboarding" });
    const root = h(
        "div",
        {
            class: "fso",
            role: "dialog",
            "aria-label": "Welcome to FullStacked"
        },
        stage,
        header,
        scroller,
        nav,
        h(
            "footer",
            { class: "fso-footer" },
            links.map((link) =>
                h(
                    "a",
                    { href: link.href, target: "_blank", rel: "noopener" },
                    link.label
                )
            )
        )
    );
    root.style.setProperty("--fso-world", WORLD_COLOR);
    el.append(root);

    const world: World | null = createWorld({
        canvas,
        labels,
        gitObjects: DEMO_DOWNLOAD.gitObjects,
        clusters: DEMO_PACKAGES,
        projectName: "demo",
        color: WORLD_COLOR,
        reducedMotion: reduced
    });
    // the welcome: the FullStacked world, turning; the build rewinds it and
    // makes it again, for real
    if (world) {
        world.animate("uIntro", 1, 1.6);
        for (const c of ["uStream", "uPkg", "uCore", "uWorld"] as const)
            world.set(c, 1);
        world.set("uFrame", 3.2);
        world.set("uElev", 0.5);
        world.animate("uFrame", 2.3, 4, { ease: "out" });
        world.animate("uElev", 0.32, 4, { ease: "out" });
    }

    // frame the world between the header and the words
    const frameWorld = () => {
        const top = header.getBoundingClientRect().bottom;
        const bottom = Math.max(
            top + 140,
            words.getBoundingClientRect().top - 8
        );
        world?.setArea(top, bottom);
        root.style.setProperty(
            "--fso-cy",
            `${Math.round((top + bottom) / 2)}px`
        );
    };
    const ro = new ResizeObserver(frameWorld);
    ro.observe(words);
    ro.observe(root);

    const flash = () => {
        if (reduced) return;
        flashLayer.replaceChildren(
            h("div", { class: "fso-flash" }),
            h("div", { class: "fso-shockwave" })
        );
    };

    // ── nav and screens ─────────────────────────────────────────────────────
    type NavAction = { label: Child; onClick: () => void; disabled?: boolean };
    const SCREEN_STEP = { welcome: 1, build: 2, ready: 3, source: 3 };

    function setNav(
        step: number,
        back: NavAction | null,
        next: NavAction | null
    ) {
        const arrow = (dir: "back" | "next") =>
            icon(dir === "back" ? "arrowLeft" : "arrowRight");
        const backButton = back
            ? button(
                  [arrow("back"), h("span", null, back.label)],
                  back.onClick,
                  "secondary",
                  {
                      class: "fso-button fso-button-secondary fso-nav-back"
                  }
              )
            : h("span", { class: "fso-nav-back" });
        if (back?.disabled) (backButton as HTMLButtonElement).disabled = true;
        const nextButton = next
            ? button(
                  [h("span", null, next.label), arrow("next")],
                  next.onClick,
                  "primary",
                  {
                      class: "fso-button fso-button-primary fso-nav-next"
                  }
              )
            : h("span", { class: "fso-nav-next" });
        if (next?.disabled) (nextButton as HTMLButtonElement).disabled = true;
        nav.replaceChildren(
            backButton,
            h("span", { class: "fso-nav-step" }, `${step} / 3`),
            nextButton
        );
    }

    function show(
        screen: "welcome" | "build" | "ready" | "source",
        content: Node[],
        { showSkip = false, skyContent = [] as Node[] } = {}
    ) {
        main.dataset.screen = screen;
        words.replaceChildren(...content.filter(Boolean));
        sky.replaceChildren(...skyContent);
        skip.style.visibility = showSkip ? "visible" : "hidden";
        scroller.scrollTop = 0;
        requestAnimationFrame(frameWorld);
        return SCREEN_STEP[screen];
    }

    function unmount() {
        buildRun++;
        ro.disconnect();
        world?.dispose();
        root.remove();
        if (!document.querySelector(".fso")) {
            document.getElementById(STYLE_ID)?.remove();
        }
    }

    async function finish(
        stats: Omit<OnboardingStats, "seconds" | "demoOpened">
    ) {
        if (finished) return;
        finished = true;
        buildRun++;
        try {
            await markOnboardingDone();
        } catch (e) {
            console.error("onboarding: could not save the config", e);
        }
        unmount();
        const full: OnboardingStats = {
            ...stats,
            seconds: Math.round((performance.now() - startedAt) / 100) / 10,
            demoOpened
        };
        resolveDone(full);
        await options.onDone(full);
    }

    // 1. Welcome
    function welcome() {
        const offline = online === false;
        const step = show(
            "welcome",
            [
                h("h1", { class: "fso-in" }, "Welcome to FullStacked"),
                h("p", { class: "fso-tagline fso-in" }, WORDS.tagline),
                h("p", { class: "fso-lead fso-in-late" }, WORDS.what),
                offline
                    ? h(
                          "div",
                          { class: "fso-notice", role: "status" },
                          icon("offline"),
                          h(
                              "p",
                              null,
                              "You're offline. Connect to the internet to get the demo project. ",
                              button(
                                  "Try again",
                                  () => {
                                      online = null;
                                      welcome();
                                      checkNetwork();
                                  },
                                  "text"
                              )
                          )
                      )
                    : null
            ],
            { showSkip: true }
        );
        setNav(
            step,
            null,
            offline
                ? {
                      label: continueLabel,
                      onClick: () => finish({ outcome: "offline" })
                  }
                : { label: "Run the demo", onClick: build }
        );
    }

    function checkNetwork() {
        if (options.offline) return;
        canReachDemo().then((reachable) => {
            online = reachable;
            // only the welcome screen changes; a build reports its own error
            if (!reachable && !finished && main.dataset.screen === "welcome")
                welcome();
        });
    }

    // 2. The build, drawn by the world while it happens
    let built: BuildReport | null = null;

    function build() {
        const runId = ++buildRun;
        const current = () => runId === buildRun && !finished;

        // everything starts over: the world flies apart, then the build
        // makes it again
        if (world) {
            world.set("uStream", 0);
            world.set("uPkg", 0);
            world.set("uCore", 0);
            world.set("uLabels", 0);
            world.animate("uWorld", 0, 1.1, { ease: "inOut" });
            world.animate("uFrame", 1.2, 6, { ease: "out" });
            world.animate("uElev", 0.1, 1.5);
        }

        const segments = new Map(
            STEPS.map((s) => {
                const fill = h("span", { class: "fso-seg-fill" });
                return [
                    s.id,
                    {
                        el: h(
                            "span",
                            { class: "fso-seg", title: WORDS.steps[s.id].name },
                            fill
                        ),
                        fill
                    }
                ] as const;
            })
        );
        const eyebrow = h("p", { class: "fso-eyebrow" });
        const big = h("p", { class: "fso-big" });
        const small = h("p", { class: "fso-small" });
        const extra = h("div", { class: "fso-extra" });
        const feedEl = h("ol", { class: "fso-feed" });
        const logEl = h("pre", { "aria-live": "off" });
        const details = h(
            "details",
            { class: "fso-details" },
            h("summary", null, "Show the details"),
            feedEl,
            logEl
        );
        const errorSlot = h("div");
        const chip = h("div", { class: "fso-source-chip" });
        let shownCopy = "";

        const say = (
            key: string,
            copy: { name: string; big: string; small: string }
        ) => {
            if (shownCopy === key) return;
            shownCopy = key;
            eyebrow.textContent = copy.name;
            big.textContent = copy.big;
            small.textContent = copy.small;
            for (const node of [big, small]) {
                node.classList.remove("fso-in");
                void node.offsetWidth;
                node.classList.add("fso-in");
            }
            requestAnimationFrame(frameWorld);
        };

        const step = show(
            "build",
            [
                h(
                    "div",
                    { class: "fso-steps-bar", "aria-hidden": "true" },
                    [...segments.values()].map((s) => s.el)
                ),
                eyebrow,
                big,
                small,
                extra,
                errorSlot,
                details
            ],
            { showSkip: true, skyContent: [chip] }
        );
        setNav(
            step,
            { label: "Back", onClick: welcome, disabled: true },
            { label: "Building…", onClick: () => {}, disabled: true }
        );

        // What really happened, step by step. On a fast device the whole build
        // takes a second; the world replays it at a pace the eye can follow
        // (each step at least MIN_SECONDS), always in the real order.
        const MIN_SECONDS: Record<StepId, number> = {
            download: 3,
            install: 4,
            bundle: 3.5
        };
        type Real = {
            started: boolean;
            snapshots: StepProgress[];
            logs: string[];
            done?: true;
        };
        const real = Object.fromEntries(
            STEPS.map((s) => [
                s.id,
                { started: false, snapshots: [], logs: [] } as Real
            ])
        ) as Record<StepId, Real>;
        let realStep: StepId = "download";
        let report: BuildReport | null = null;
        let failure: { step: StepId; message: string } | null = null;
        let targetDir = `/${cloneDir}`;
        let logText = "";

        let shown = 0;
        let shownFraction = 0;
        let shownSince = performance.now();
        let shownLogs = 0;
        let last = performance.now();
        const feedLines: string[] = [];

        const feedTo = (id: StepId, count: number) => {
            const logs = real[id].logs;
            while (shownLogs < Math.min(count, logs.length)) {
                feedLines.push(logs[shownLogs++]);
                if (feedLines.length > 4) feedLines.shift();
            }
            feedEl.replaceChildren(...feedLines.map((l) => h("li", null, l)));
        };

        const startStep = (id: StepId) => {
            say(id, WORDS.steps[id]);
            shownSince = performance.now();
            chip.replaceChildren();
            if (id === "download")
                chip.append(
                    h(
                        "span",
                        { class: "fso-chip fso-chip-left" },
                        h("i"),
                        "github.com/fullstackedorg/demo"
                    )
                );
            if (id === "install")
                chip.append(
                    h(
                        "span",
                        { class: "fso-chip fso-chip-right" },
                        h("i"),
                        "registry.npmjs.org"
                    )
                );
            if (!world) return;
            if (id === "install") {
                // pull back to see every package land
                world.animate("uFrame", 1.95, 2.5);
                world.animate("uElev", 0.04, 2.5);
            }
            if (id === "bundle") {
                // close in on the core as everything falls into it
                world.animate("uLabels", 0, 0.4);
                world.animate("uFrame", 0.72, 2.2);
                world.animate("uElev", 0.22, 2.2);
                // the files esbuild bundles: the engine and the screen in one
                findExcerpt(targetDir).then((excerpt) => {
                    if (excerpt && current()) {
                        extra.replaceChildren(codeCard(excerpt));
                        requestAnimationFrame(frameWorld);
                    }
                });
            }
        };

        const follow = (id: StepId, fraction: number) => {
            segments.get(id).fill.style.width =
                `${Math.round(fraction * 100)}%`;
            if (!world) return;
            if (id === "download") world.follow("uStream", fraction);
            if (id === "install") {
                world.follow("uPkg", fraction);
                if (fraction > 0.65 && world.get("uLabels") === 0)
                    world.animate("uLabels", 1, 0.8);
            }
            if (id === "bundle") world.follow("uCore", fraction);
        };

        const ignite = (report: BuildReport) => {
            built = report;
            chip.replaceChildren();
            extra.replaceChildren();
            say("running", WORDS.running);
            if (world) {
                // the core bursts into the world; the camera is thrown back by
                // the blast, then dives in, down to the ring's plane
                world.ignite();
                world.animate("uWorld", 1, 2.4, { ease: "linear" });
                world.sequence("uFrame", [
                    [3, 1.2, "out"],
                    [1.3, 3.6, "inOut"]
                ]);
                world.sequence("uElev", [
                    [0.6, 1.2, "out"],
                    [0.13, 3.6, "inOut"]
                ]);
                world.animate("uAzim", world.get("uAzim") + 0.8, 4.8);
            }
            flash();
            setNav(
                step,
                { label: "Back", onClick: welcome },
                { label: "Next", onClick: () => ready(report) }
            );
            setTimeout(
                () =>
                    current() &&
                    main.dataset.screen === "build" &&
                    ready(report),
                reduced ? 1500 : 4200
            );
        };

        const play = (now: number) => {
            if (!current()) return;
            const dt = Math.min(0.1, (now - last) / 1000);
            last = now;
            const id = STEPS[shown]?.id;
            if (!id) return;
            const r = real[id];
            if (!r.started) {
                requestAnimationFrame(play);
                return;
            }
            if (shownCopy !== id) startStep(id);

            const measured = r.snapshots.filter(
                (s) => s.fraction !== undefined
            );
            // esbuild gives no progress: its bar moves with time, and waits
            // for the real end before it completes
            const target = r.done
                ? 1
                : measured.length
                  ? (measured.at(-1)?.fraction ?? 0)
                  : Math.min(0.9, (now - shownSince) / 1000 / MIN_SECONDS[id]);
            shownFraction = Math.min(
                target,
                shownFraction + dt / MIN_SECONDS[id]
            );
            follow(id, shownFraction);
            feedTo(id, Math.ceil(r.logs.length * (r.done ? shownFraction : 1)));

            if (failure && failure.step === id && !r.done) {
                failed(failure.step, failure.message);
                return;
            }
            if (r.done && shownFraction >= 1) {
                feedTo(id, r.logs.length);
                shown++;
                shownFraction = 0;
                shownLogs = 0;
                if (shown === STEPS.length) {
                    if (report) ignite(report);
                    return;
                }
            }
            requestAnimationFrame(play);
        };
        requestAnimationFrame(play);

        const failed = (failedStep: StepId, message: string) => {
            say(`failed-${failedStep}`, {
                name: WORDS.steps[failedStep].name,
                big: "That didn't work.",
                small: failureSentence(failedStep, message)
            });
            details.open = true;
            errorSlot.replaceChildren(
                button(continueLabel, () =>
                    finish({
                        outcome: "failed",
                        error: { step: failedStep, message }
                    })
                )
            );
            setNav(
                step,
                { label: "Back", onClick: welcome },
                { label: "Try again", onClick: build }
            );
        };

        buildDemo(cloneDir, {
            onTarget(dir) {
                targetDir = dir;
            },
            onStep(id) {
                if (!current()) return;
                realStep = id;
                real[id].started = true;
            },
            onProgress(id, p) {
                if (current()) real[id].snapshots.push({ ...p });
            },
            onStepDone(id) {
                if (current()) real[id].done = true;
            },
            onLog(line) {
                if (!current()) return;
                logText += line + "\n";
                logEl.textContent = logText;
                real[realStep].logs.push(line);
            }
        })
            .then((result) => {
                if (!current()) return;
                report = result;
                // the replay may be done already
                if (shown === STEPS.length) ignite(result);
            })
            .catch((e) => {
                if (!current()) return;
                const failedStep: StepId =
                    e instanceof StepError ? e.step : "download";
                const message =
                    e instanceof StepError
                        ? e.message
                        : String(e?.message ?? e);
                real[failedStep].started = true;
                failure = { step: failedStep, message };
                if (shown >= STEPS.findIndex((s) => s.id === failedStep))
                    failed(failedStep, message);
            });
    }

    // 3. Ready: the world keeps turning behind
    function ready(report: BuildReport) {
        if (world) {
            world.set("uStream", 1);
            world.set("uPkg", 1);
            world.set("uCore", 1);
            world.set("uLabels", 0);
            if (world.get("uWorld") < 1) world.animate("uWorld", 1, 1.2);
            world.animate("uFrame", 2.25, 2.5);
            world.animate("uElev", 0.36, 2.5);
        }
        const note = h("p", { class: "fso-note", role: "status" });

        const openDemo = async () => {
            try {
                const ctx = await run({ directory: report.directory });
                const open = (globalThis as any).fullstacked?.open;
                if (typeof open !== "function") {
                    note.textContent = `The demo project is running, but FullStacked can't open a window here. In the terminal: fullstacked ${report.directory}`;
                    return;
                }
                open(ctx);
                demoOpened = true;
                note.textContent = "The demo project opened in a new window.";
            } catch (e) {
                note.textContent = `Could not open the demo project: ${(e as any)?.message ?? e}`;
            }
        };

        const step = show("ready", [
            h("h1", { class: "fso-in" }, "Your demo project is ready"),
            h(
                "button",
                {
                    type: "button",
                    class: "fso-open-demo fso-in-late",
                    onclick: openDemo
                },
                icon("external"),
                h(
                    "span",
                    { class: "fso-open-demo-text" },
                    h("strong", null, "Explore the demo"),
                    h(
                        "span",
                        null,
                        "See what's inside, then rebuild it offline."
                    )
                )
            ),
            note,
            h(
                "div",
                { class: "fso-actions fso-in-late" },
                button(
                    [icon("file"), "View the source"],
                    () => source(report, `/${report.directory}`),
                    "text"
                )
            )
        ]);
        setNav(
            step,
            { label: "Back", onClick: welcome },
            {
                label: continueLabel,
                onClick: () => finish({ outcome: "built", report })
            }
        );
    }

    // View source: the downloaded files, read-only
    async function source(report: BuildReport, dir: string) {
        const rootDir = `/${report.directory}`;
        const back = () =>
            dir === rootDir
                ? ready(report)
                : source(report, dir.slice(0, dir.lastIndexOf("/")));
        const list = h("ul", { class: "fso-files" });
        const step = show("source", [sourceBar(dir.slice(1) + "/"), list]);
        setNav(
            step,
            { label: "Back", onClick: back },
            { label: "Done", onClick: () => ready(report) }
        );
        try {
            for (const entry of await listDirectory(dir)) {
                list.append(
                    h(
                        "li",
                        null,
                        h(
                            "button",
                            {
                                type: "button",
                                onclick: () =>
                                    entry.directory
                                        ? source(report, entry.path)
                                        : file(report, entry.path)
                            },
                            icon(entry.directory ? "folder" : "file"),
                            entry.name + (entry.directory ? "/" : "")
                        )
                    )
                );
            }
        } catch (e) {
            list.replaceWith(
                h(
                    "p",
                    null,
                    `Could not list ${dir}: ${(e as any)?.message ?? e}`
                )
            );
        }
    }

    async function file(report: BuildReport, path: string) {
        const parent = path.slice(0, path.lastIndexOf("/"));
        const content = h("pre", null, "Loading…");
        const step = show("source", [
            sourceBar(path.slice(1)),
            h("div", { class: "fso-file-view" }, content)
        ]);
        setNav(
            step,
            { label: "Back", onClick: () => source(report, parent) },
            { label: "Done", onClick: () => ready(report) }
        );
        try {
            const preview = await readPreview(path);
            content.textContent =
                "text" in preview
                    ? preview.text
                    : "binary" in preview
                      ? `Binary file, ${formatBytes(preview.binary)}`
                      : `Too large to show here, ${formatBytes(preview.tooLarge)}`;
        } catch (e) {
            content.textContent = `Could not read ${path}: ${(e as any)?.message ?? e}`;
        }
    }

    function sourceBar(title: string) {
        return h(
            "div",
            { class: "fso-source-bar" },
            icon("folder"),
            h("span", { class: "fso-source-path" }, title)
        );
    }

    welcome();
    checkNetwork();

    return { done, unmount };
}

// Real lines of the project being built: the engine (Node.js) and the screen
// (the browser) in one file
function codeCard(excerpt: Excerpt) {
    return h(
        "figure",
        { class: "fso-code fso-in" },
        h(
            "figcaption",
            null,
            h("span", { class: "fso-code-file" }, excerpt.file),
            h(
                "span",
                { class: "fso-code-legend" },
                h("span", { class: "fso-api-node" }, "Engine"),
                h("span", { class: "fso-api-browser" }, "Screen")
            )
        ),
        h(
            "div",
            { class: "fso-code-lines" },
            excerpt.lines.map((l) =>
                l.kind === "gap"
                    ? h("div", { class: "fso-code-gap" }, "⋮")
                    : h(
                          "div",
                          { class: `fso-code-line fso-api-${l.api}` },
                          h("code", null, l.text)
                      )
            )
        )
    );
}

// friendly words on screen; the technical error is in the details
function failureSentence(step: StepId, message: string) {
    console.error(`onboarding: ${step} failed: ${message}`);
    return step === "bundle"
        ? "The project couldn't be put together. Try again."
        : "Check your internet connection, then try again.";
}
