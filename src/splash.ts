// The splash: the onboarding's first paint is the FullStacked mark alone, in
// the middle of the stage, fading in slowly while everything loads hidden
// behind it (the world draws its first frames and the frame-rate governor
// settles, the fonts load). Then the mark moves to its place top left and,
// once it is there and after a short pause, the world and the words come in
// together. Only the onboarding has a splash: every later launch opens
// straight on the terminal.

import { h } from "./ui/dom";

// the mark's move to the top left (as long as .fso-splash-mark's transition
// in styles.ts)
const MOVE_SECONDS = 0.9;
// the pause between the mark in place and the world and words coming in
const PAUSE_SECONDS = 0.35;
// the mark's fade in (.fso-splash-mark in styles.ts) and a beat after it: it
// always plays out before the mark moves
const MIN_SECONDS = 2.2;
const FONTS_SECONDS = 1;

export type SplashOptions = {
    root: HTMLElement; // .fso
    logo: string; // the mark's markup
    brand: HTMLElement; // where the mark goes: the header's link
    ready: Promise<unknown>; // everything loaded (the world warmed up)
    reduced: boolean; // prefers-reduced-motion: a fade, no move
    onReveal: () => void; // the mark is in place: the world and the words come in
};

const wait = (seconds: number) =>
    new Promise<void>((resolve) => setTimeout(resolve, seconds * 1000));

export function startSplash(opts: SplashOptions) {
    const { root, brand, reduced } = opts;
    const mark = h("div", {
        class: "fso-splash-mark",
        "aria-hidden": "true",
        html: opts.logo
    });
    root.classList.add("fso-splash");
    root.append(mark);
    let cancelled = false;
    const timers: ReturnType<typeof setTimeout>[] = [];

    const fonts = document.fonts?.ready ?? Promise.resolve();
    const revealed = Promise.all([
        opts.ready.catch(() => {}),
        Promise.race([fonts, wait(FONTS_SECONDS)]),
        wait(reduced ? 0.2 : MIN_SECONDS)
    ])
        // the last layout (the world framed above the words) is in
        .then(() => new Promise((r) => requestAnimationFrame(r)))
        .then(() => {
            if (!cancelled) reveal();
        });

    function reveal() {
        const to = (
            brand.querySelector("svg") ?? brand
        ).getBoundingClientRect();
        const from = mark.getBoundingClientRect();
        // FLIP: the mark lands exactly on the header's (same shape, same
        // opacity), which then takes its place
        if (!reduced && from.width && to.width)
            mark.style.transform = `translate(${to.left - from.left}px, ${to.top - from.top}px) scale(${to.width / from.width})`;
        mark.classList.add("fso-splash-leave");
        const landed = MOVE_SECONDS * 1000 + 50;
        timers.push(
            setTimeout(() => {
                mark.remove();
                root.classList.add("fso-landed");
            }, landed),
            setTimeout(
                () => {
                    root.classList.remove("fso-splash", "fso-landed");
                    opts.onReveal();
                },
                landed + PAUSE_SECONDS * 1000
            )
        );
    }

    return {
        revealed,
        // the onboarding left during the splash
        cancel() {
            cancelled = true;
            timers.forEach(clearTimeout);
            mark.remove();
        }
    };
}
