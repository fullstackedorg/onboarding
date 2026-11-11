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
import { formatBytes } from "./format";
import { button, h, icon, type Child } from "./ui/dom";
import { css, PAGE_COLOR } from "./ui/styles";
import { createWorld, type World } from "./world/world";
import { startSplash } from "./splash";

export const ONBOARDING_CONFIG_KEY = "onboarding";

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
    // label of the last button, once the demo project is ready (default
    // "Finish"); offline or after a failure, the way out says "Continue"
    continueLabel?: string;
    // where the demo is cloned, from the projects folder (default "demo")
    cloneDir?: string;
    // behave as if there was no network (development)
    offline?: boolean;
};

export type OnboardingHandle = {
    // the stats given to onDone, once it was called
    done: Promise<OnboardingStats>;
    // remove the onboarding without calling onDone
    unmount: () => void;
};

// the top left mark links there
const SITE = "https://fullstacked.org";

// The FullStacked mark, monochrome (the app icon's paths)
const LOGO = `<svg viewBox="49 6.5 601 709" aria-hidden="true" fill="currentColor"><path d="M73.6316 550.363L358.404 715.202V378.205C358.404 365.062 365.385 352.902 376.758 346.331L637.136 195.618C650.745 187.748 650.745 168.034 637.136 160.124L382.994 13.1106C367.777 4.29613 349.069 4.29613 333.852 13.1106L67.3957 167.247C56.0221 173.818 49.0411 185.977 49.0411 199.16V507.628C49.0411 525.257 58.4145 541.549 73.6316 550.363Z"/><path d="M635.832 338.37L569.82 300.091L415.336 389.526V501.419L635.832 373.744C649.41 365.892 649.41 346.222 635.832 338.37Z"/><path d="M635.793 517.28L569.155 478.687L415.336 567.73V679.976L635.754 552.654C649.332 544.802 649.371 525.133 635.754 517.241L635.793 517.28Z"/></svg>`;

// FullStacked's blue: the world, the buttons, the glow
const WORLD_COLOR = "#219ef2";

// how long the welcome's world takes to come apart when the build starts
const LEAVE_SECONDS = 2.4;

// The words. One catchy, non-technical line per screen, no exact numbers:
// whole projects, built and run on this device.
const WORDS = {
    tagline: "Build anything. Run it everywhere.",
    what: "Whole projects, built and running right here. No server needed.",
    steps: {
        download: {
            name: "Download",
            big: "Pulling demo project onto this device.",
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

// The status bar takes its colour from the page (iOS reads the webview's
// underPageBackgroundColor, browsers read theme-color): paint the page with
// the stage's top colour while the onboarding is up, and give back whatever
// was there when it leaves.
function paintPage() {
    const html = document.documentElement;
    const body = document.body;
    const before = [html.style.backgroundColor, body.style.backgroundColor];
    html.style.backgroundColor = PAGE_COLOR;
    body.style.backgroundColor = PAGE_COLOR;
    let meta = document.querySelector<HTMLMetaElement>(
        'meta[name="theme-color"]'
    );
    const created = !meta;
    const content = meta?.content;
    if (!meta) {
        meta = h("meta", { name: "theme-color" });
        document.head.append(meta);
    }
    meta.content = PAGE_COLOR;
    return () => {
        html.style.backgroundColor = before[0];
        body.style.backgroundColor = before[1];
        if (created) meta.remove();
        else meta.content = content ?? "";
    };
}

const reducedMotion = () =>
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

export function startOnboarding(
    el: HTMLElement,
    options: OnboardingOptions
): OnboardingHandle {
    const continueLabel = options.continueLabel ?? "Finish";
    const cloneDir = options.cloneDir ?? "demo";
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
    const brand = h("a", {
        class: "fso-brand",
        href: SITE,
        target: "_blank",
        rel: "noopener",
        "aria-label": "FullStacked (fullstacked.org)",
        html: LOGO
    });
    const header = h("header", { class: "fso-header" }, brand, skip);
    // the world fills the space above the words
    const sky = h("div", { class: "fso-sky" });
    const words = h("div", { class: "fso-words" });
    const main = h("main", { class: "fso-main" }, sky, words);
    const scroller = h("div", { class: "fso-scroll" }, main);
    // a secondary action on the left, Next on the right: always at the
    // bottom, in the same place
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
        nav
    );
    root.style.setProperty("--fso-world", WORLD_COLOR);
    el.append(root);
    const unpaintPage = paintPage();

    const world: World | null = createWorld({
        canvas,
        labels,
        gitObjects: DEMO_DOWNLOAD.gitObjects,
        clusters: DEMO_PACKAGES,
        projectName: "demo",
        color: WORLD_COLOR,
        reducedMotion: reduced,
        // a device that can't hold the frame rate drops the page's costly
        // effects (blurs) too
        onQuality: (_, lite) => root.classList.toggle("fso-lite", lite)
    });
    // the welcome: the FullStacked world, turning; the build rewinds it and
    // makes it again, for real. Behind the splash it draws hidden, fully lit,
    // until the frame rate settles; then it fades in from far away.
    if (world) {
        for (const c of [
            "uIntro",
            "uStream",
            "uPkg",
            "uCore",
            "uWorld"
        ] as const)
            world.set(c, 1);
        world.set("uFrame", 3.2);
        world.set("uElev", 0.5);
    }
    const splash = startSplash({
        root,
        logo: LOGO,
        brand,
        ready: world ? world.warmup(1.6) : Promise.resolve(),
        reduced,
        onReveal: () => {
            if (!world) return;
            world.set("uIntro", 0);
            world.animate("uIntro", 1, 1.8);
            world.animate("uFrame", 2.3, 4, { ease: "out" });
            world.animate("uElev", 0.32, 4, { ease: "out" });
        }
    });

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
        // from now on, a new center is eased to, never jumped to
        if (!root.classList.contains("fso-settled"))
            requestAnimationFrame(() => root.classList.add("fso-settled"));
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
    type NavAction = {
        label: Child;
        onClick: () => void;
        disabled?: boolean;
        expanded?: boolean; // a toggle (Show details)
    };

    // left: Show details, once there is a record, or nothing; right: Next,
    // disabled while a step runs
    function setNav(side: NavAction | null, next: NavAction | null) {
        const sideButton = side
            ? button(side.label, side.onClick, "secondary", {
                  class: "fso-button fso-button-secondary fso-nav-side",
                  "aria-expanded":
                      side.expanded === undefined
                          ? undefined
                          : String(side.expanded)
              })
            : null;
        const nextButton = next
            ? button(
                  [h("span", null, next.label), icon("arrowRight")],
                  next.onClick,
                  "primary",
                  {
                      class: "fso-button fso-button-primary fso-nav-next"
                  }
              )
            : null;
        if (next?.disabled) nextButton.disabled = true;
        nav.replaceChildren(
            ...[
                sideButton,
                h("span", { class: "fso-nav-spacer" }),
                nextButton
            ].filter(Boolean)
        );
    }

    // The build's record (Show details): made by the build, kept until the
    // end, folded on each new screen
    let detailsEl: HTMLElement | null = null;
    let detailsOpen = false;
    let nextAction: NavAction | null = null;

    function setDetails(open: boolean) {
        detailsOpen = open && !!detailsEl;
        if (detailsEl) detailsEl.hidden = !detailsOpen;
        // the world steps back while the details are read
        root.classList.toggle("fso-reading", detailsOpen);
        requestAnimationFrame(frameWorld);
    }

    function renderNav() {
        setNav(
            detailsEl
                ? {
                      label: detailsOpen ? "Hide details" : "Show details",
                      expanded: detailsOpen,
                      onClick: () => {
                          setDetails(!detailsOpen);
                          renderNav();
                          if (detailsOpen)
                              requestAnimationFrame(() =>
                                  detailsEl?.scrollIntoView({
                                      block: "nearest",
                                      behavior: reduced ? "auto" : "smooth"
                                  })
                              );
                      }
                  }
                : null,
            nextAction
        );
    }

    function setNext(next: NavAction | null) {
        nextAction = next;
        renderNav();
    }

    function show(
        screen: "welcome" | "build" | "ready",
        content: Node[],
        { showSkip = false, skyContent = [] as Node[] } = {}
    ) {
        main.dataset.screen = screen;
        setDetails(false);
        words.replaceChildren(...content.filter(Boolean));
        sky.replaceChildren(...skyContent);
        skip.style.visibility = showSkip ? "visible" : "hidden";
        scroller.scrollTop = 0;
        requestAnimationFrame(frameWorld);
    }

    // The keyboard: → and Enter are Next (once it's enabled), Escape is Skip
    // (where Skip shows). Enter on a focused button or link stays that
    // button's; a held key doesn't run through the steps.
    const onKey = (e: KeyboardEvent) => {
        if (finished || e.defaultPrevented || e.repeat) return;
        // nothing to act on until the splash is gone
        if (root.classList.contains("fso-splash")) return;
        if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
        if (e.key === "ArrowRight" || e.key === "Enter") {
            const target = e.target as Element | null;
            if (
                e.key === "Enter" &&
                target?.closest?.("button, a, input, textarea, select")
            )
                return;
            const next = nav.querySelector<HTMLButtonElement>(".fso-nav-next");
            if (!next || next.disabled) return;
            e.preventDefault();
            next.click();
        } else if (e.key === "Escape") {
            if (skip.style.visibility === "hidden") return;
            e.preventDefault();
            skip.click();
        }
    };
    document.addEventListener("keydown", onKey);

    function unmount() {
        buildRun++;
        document.removeEventListener("keydown", onKey);
        splash.cancel();
        ro.disconnect();
        world?.dispose();
        root.remove();
        unpaintPage();
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
        show(
            "welcome",
            [
                // word by word, then the tagline and the line
                h(
                    "h1",
                    null,
                    "Welcome to FullStacked"
                        .split(" ")
                        .flatMap((word, i) => [
                            i ? " " : null,
                            h(
                                "span",
                                { class: "fso-word", style: `--fso-i: ${i}` },
                                word
                            )
                        ])
                ),
                h(
                    "p",
                    { class: "fso-tagline fso-in fso-after-1" },
                    WORDS.tagline
                ),
                h("p", { class: "fso-lead fso-in fso-after-2" }, WORDS.what),
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
            null,
            offline
                ? {
                      label: "Continue",
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

        // everything starts over: the world comes apart, back to where it
        // came from (GitHub and the npm registry), fading as it goes, while
        // the download starts streaming in. One continuous move: the
        // particles still on the world stay lit (the shader), so resetting
        // the build's steps under it shows nothing.
        if (world) {
            world.set("uLeave", 1);
            world.set("uStream", 0);
            world.set("uPkg", 0);
            world.set("uCore", 0);
            world.set("uLabels", 0);
            // linear: each particle eases its own way off (the shader), so
            // the fade is spread over the whole move, not bunched in its middle
            world.animate("uWorld", 0, LEAVE_SECONDS, { ease: "linear" });
            world.animate("uFrame", 1.2, 6, { ease: "out" });
            world.animate("uElev", 0.1, 1.5);
            // face the build head-on, whatever the camera did before
            world.animate("uAzim", 0, 1.1, { ease: "inOut" });
        }

        // the stepper: the three build steps; the run follows the build on
        // its own (the details still record it)
        type UiStep = StepId | "run";
        const segments = new Map(
            STEPS.map(({ id }) => {
                const fill = h("span", { class: "fso-seg-fill" });
                const name = WORDS.steps[id].name;
                return [
                    id,
                    {
                        el: h("span", { class: "fso-seg", title: name }, fill),
                        fill
                    }
                ] as const;
            })
        );
        const eyebrow = h("p", { class: "fso-eyebrow" });
        // Every title of the build, stacked in one grid cell: only the
        // current one shows, but all of them size the cell, so it is as tall
        // as the longest title at this width (two lines on a phone, one on a
        // wide screen) and nothing below or above moves between steps.
        // Words that aren't a step's title (a failure) use the last line.
        const titles = [
            ...STEPS.map((s) => WORDS.steps[s.id].big),
            WORDS.running.big
        ];
        const titleEls = titles.map((t) => h("span", null, t));
        const otherTitle = h("span");
        const big = h("p", { class: "fso-big" }, titleEls, otherTitle);
        const small = h("p", { class: "fso-small" });
        // the details, folded: a record of everything that happened, one
        // section per step as it plays, kept for the whole build
        const details = h("div", { class: "fso-details", hidden: true });
        type Entry = {
            done: HTMLElement;
            extra: HTMLElement;
            log: HTMLPreElement;
        };
        const records = new Map<UiStep, Entry>();
        const record = (id: UiStep): Entry => {
            let r = records.get(id);
            if (r) return r;
            const name =
                id === "run" ? WORDS.running.name : WORDS.steps[id].name;
            r = {
                done: h("span", { class: "fso-record-done" }),
                extra: h("div"),
                log: h("pre", { "aria-live": "off" })
            };
            r.log.hidden = true;
            details.append(
                h(
                    "section",
                    { class: "fso-record" },
                    h("h3", null, name, r.done),
                    r.extra,
                    r.log
                )
            );
            records.set(id, r);
            return r;
        };
        const writeLines = (id: UiStep, lines: string[]) => {
            if (!lines.length) return;
            const log = record(id).log;
            log.hidden = false;
            log.textContent += lines.join("\n") + "\n";
        };
        const markDone = (id: UiStep, summary: string) => {
            const r = record(id);
            r.done.replaceChildren(icon("check"), summary);
        };
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
            const index = titles.indexOf(copy.big);
            if (index < 0) otherTitle.textContent = copy.big;
            const current = titleEls[index] ?? otherTitle;
            for (const el of [...titleEls, otherTitle])
                el.toggleAttribute("data-current", el === current);
            small.textContent = copy.small;
            for (const node of [current, small]) {
                node.classList.remove("fso-in");
                void node.offsetWidth;
                node.classList.add("fso-in");
            }
            requestAnimationFrame(frameWorld);
        };

        show(
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
                errorSlot,
                details
            ],
            { showSkip: true, skyContent: [chip] }
        );

        // this build's record is the one Show details unfolds, until the end
        detailsEl = details;
        // Every step waits for the person: Next stays off while a step runs,
        // turns on once it's done, and only a click moves on.
        const lockNav = () =>
            setNext({ label: "Next", onClick: () => {}, disabled: true });
        lockNav();

        // What really happened, step by step. On a fast device the whole build
        // takes a second; the world replays it at a pace the eye can follow
        // (each step at least MIN_SECONDS), always in the real order.
        const MIN_SECONDS: Record<StepId, number> = {
            download: 3,
            install: 4,
            bundle: 3.5
        };
        // A download or an install that shows no sign of life for this long
        // (a dropped connection) fails with Try again instead of hanging.
        // The bundle has its own timeout (build.ts).
        const STALL_SECONDS = 90;
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
        const summaries: Partial<Record<StepId, string>> = {};
        let lastActivity = performance.now();
        const alive = () => (lastActivity = performance.now());

        let shown = 0;
        let shownFraction = 0;
        let shownSince = performance.now();
        let last = performance.now();
        let waiting = false;
        // how many of each step's lines are in the record
        const written: Record<StepId, number> = {
            download: 0,
            install: 0,
            bundle: 0
        };

        const feedTo = (id: StepId, count: number) => {
            const logs = real[id].logs;
            const to = Math.min(count, logs.length);
            if (to <= written[id]) return;
            writeLines(id, logs.slice(written[id], to));
            written[id] = to;
        };

        const startStep = (id: StepId) => {
            say(id, WORDS.steps[id]);
            record(id);
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
            if (id === "bundle")
                // the files esbuild bundles: the engine and the screen in
                // one, for the curious, in the details
                findExcerpt(targetDir).then((excerpt) => {
                    if (excerpt && current())
                        record("bundle").extra.replaceChildren(
                            codeCard(excerpt)
                        );
                });
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

        // Run, right after the build (no Next in between): the core bursts
        // into the world, the project is alive
        let ran = false;
        const runStep = (report: BuildReport) => {
            if (ran || !current()) return;
            ran = true;
            built = report;
            chip.replaceChildren();
            say("running", WORDS.running);
            // lines the build wrote after its last step (build.json)
            feedTo("bundle", Infinity);
            writeLines("run", [
                ...report.bundle.outputs.map(
                    (o) => `out/${o.name}  ${formatBytes(o.bytes)}`
                ),
                `Built on this device in ${report.seconds.total} s, in ${report.directory}/`
            ]);
            if (world) {
                // a new world bursts out (the world is gone by now: no jump)
                world.set("uLeave", 0);
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
            lockNav();
            // Next once the burst has played
            setTimeout(
                () => {
                    if (!current()) return;
                    markDone("run", "running");
                    setNext({ label: "Next", onClick: () => ready(report) });
                },
                reduced ? 1000 : 3200
            );
        };

        // a step is done on screen: wait for Next before the following one,
        // except after the last, where the run follows on its own
        const stepDone = () => {
            if (shown === STEPS.length - 1) {
                shown++;
                // the build may still be writing its report: its .then runs
                // the run then
                if (report) runStep(report);
                return;
            }
            waiting = true;
            setNext({
                label: "Next",
                onClick: () => {
                    if (!waiting || !current()) return;
                    waiting = false;
                    shown++;
                    shownFraction = 0;
                    lockNav();
                    last = performance.now();
                    requestAnimationFrame(play);
                }
            });
        };

        const play = (now: number) => {
            if (!current() || waiting) return;
            const dt = Math.min(0.1, (now - last) / 1000);
            last = now;
            const id = STEPS[shown]?.id;
            if (!id) return;
            const r = real[id];
            if (failure && failure.step === id && !r.done) {
                failed(failure.step, failure.message);
                return;
            }
            if (!r.started) {
                requestAnimationFrame(play);
                return;
            }
            if (shownCopy !== id) startStep(id);

            // Never frozen: while a step runs, time alone moves its bar
            // toward 90 % (slower and slower); real progress, when the step
            // reports it, moves it faster. Only the real end completes it.
            const measured = r.snapshots.filter(
                (s) => s.fraction !== undefined
            );
            const reported = measured.at(-1)?.fraction ?? 0;
            const elapsed = (now - shownSince) / 1000;
            const creep =
                0.9 * (1 - Math.exp(-elapsed / (MIN_SECONDS[id] * 2)));
            const target = r.done ? 1 : Math.max(reported, creep);
            shownFraction = Math.max(
                shownFraction,
                Math.min(target, shownFraction + dt / MIN_SECONDS[id])
            );
            follow(id, shownFraction);
            feedTo(id, Math.ceil(r.logs.length * (r.done ? shownFraction : 1)));

            if (r.done && shownFraction >= 1) {
                feedTo(id, r.logs.length);
                markDone(id, summaries[id] ?? "done");
                stepDone();
                return;
            }
            requestAnimationFrame(play);
        };
        requestAnimationFrame(play);

        const failed = (failedStep: StepId, message: string) => {
            if (!current()) return;
            clearInterval(watchdog);
            // everything the failed step wrote, its error last
            record(failedStep);
            feedTo(failedStep, Infinity);
            say(`failed-${failedStep}`, {
                name: WORDS.steps[failedStep].name,
                big: "That didn't work.",
                small: failureSentence(failedStep, message)
            });
            setDetails(true);
            errorSlot.replaceChildren(
                button("Continue", () =>
                    finish({
                        outcome: "failed",
                        error: { step: failedStep, message }
                    })
                )
            );
            setNext({ label: "Try again", onClick: build });
        };

        // shown when the replay reaches the failed step
        const fail = (failedStep: StepId, message: string) => {
            if (failure || !current()) return;
            real[failedStep].started = true;
            failure = { step: failedStep, message };
            if (
                !waiting &&
                shown === STEPS.findIndex((s) => s.id === failedStep)
            )
                failed(failedStep, message);
        };

        const watchdog = setInterval(() => {
            if (!current() || report || failure) {
                clearInterval(watchdog);
                return;
            }
            if (realStep === "bundle" || real[realStep].done) return;
            if ((performance.now() - lastActivity) / 1000 < STALL_SECONDS)
                return;
            real[realStep].logs.push(
                `No progress for ${STALL_SECONDS} seconds`
            );
            fail(realStep, `no progress for ${STALL_SECONDS} seconds`);
        }, 2000);

        // the bundle waits for the welcome's world to be gone (a fast build,
        // a replay, gets there in a second, and its main-thread work would
        // stutter the transition); a first download takes longer anyway
        const leaveDone = new Promise<void>((resolve) =>
            setTimeout(resolve, world && !reduced ? LEAVE_SECONDS * 1000 : 0)
        );

        buildDemo(cloneDir, {
            beforeBundle: () => leaveDone,
            onTarget(dir) {
                targetDir = dir;
            },
            onStep(id) {
                if (!current()) return;
                alive();
                realStep = id;
                real[id].started = true;
            },
            onProgress(id, p) {
                if (!current()) return;
                alive();
                real[id].snapshots.push({ ...p });
            },
            onStepDone(id, summary) {
                if (!current()) return;
                alive();
                summaries[id] = summary;
                real[id].done = true;
            },
            onLog(line) {
                if (!current()) return;
                alive();
                real[realStep].logs.push(line);
            }
        })
            .then((result) => {
                if (!current() || failure) return;
                report = result;
                // the build may have finished on screen already, waiting
                // for this
                if (shown === STEPS.length) runStep(result);
            })
            .catch((e) => {
                if (!current()) return;
                fail(
                    e instanceof StepError ? e.step : "download",
                    e instanceof StepError ? e.message : String(e?.message ?? e)
                );
            });
    }

    // 3. Ready: the world keeps turning behind
    function ready(report: BuildReport) {
        if (world) {
            world.set("uStream", 1);
            world.set("uPkg", 1);
            world.set("uCore", 1);
            world.set("uLabels", 0);
            world.animate("uLeave", 0, 0.3);
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

        show("ready", [
            h("h1", { class: "fso-in" }, "The demo project is ready"),
            h(
                "button",
                {
                    type: "button",
                    class: "fso-open-demo fso-in-late",
                    onclick: openDemo
                },
                h(
                    "span",
                    { class: "fso-open-demo-text" },
                    h("strong", null, "Explore the demo"),
                    h("span", null, "See what's inside.")
                ),
                icon("external")
            ),
            note,
            // the build's record, folded: Show details
            detailsEl
        ]);
        setNext({
            label: continueLabel,
            onClick: () => finish({ outcome: "built", report })
        });
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
