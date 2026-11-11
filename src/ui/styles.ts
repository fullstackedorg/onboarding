// The onboarding's stylesheet, as a string: it is injected with the
// onboarding and removed with it, so it works the same in the app's shell
// page (no CSS output there) and in the standalone dev page.
// Everything is scoped under .fso. A dark stage whatever the system theme
// (the world glows on it). Mobile first: 375 px, safe areas, 44 px targets.

// The page colour while the onboarding is up: the stage's top edge fades
// into it, and the onboarding paints <html>, <body> and theme-color with it,
// since the native shells take the status bar colour from the page (iOS
// underPageBackgroundColor, browsers' theme-color). A deep navy, not black,
// so it reads as the top of the blob's glow.
export const PAGE_COLOR = "#06101f";

export const css = `
/* the world's center on the screen, eased between screens like the world's
   framing (AREA_SECONDS in world/world.ts); set once before it is eased */
@property --fso-cy { syntax: "<length>"; inherits: true; initial-value: 0px; }
.fso.fso-settled { transition: --fso-cy 0.9s cubic-bezier(0.65, 0, 0.35, 1); }
.fso {
    --fso-top: ${PAGE_COLOR};
    --fso-stage: #030914;
    --fso-world: #219ef2;
    --fso-text: #f3f6fd;
    --fso-muted: rgb(214 223 242 / 0.7);
    --fso-dim: rgb(214 223 242 / 0.5);
    --fso-line: rgb(255 255 255 / 0.14);
    --fso-card: rgb(12 18 32 / 0.62);
    --fso-accent-text: #ffffff;
    --fso-success: #4ade80;
    --fso-danger: #f87171;
    --fso-radius: 14px;
    --fso-font: system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", sans-serif;
    --fso-mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;

    position: fixed;
    inset: 0;
    z-index: 2147483000;
    display: flex;
    flex-direction: column;
    color-scheme: dark;
    background: var(--fso-stage);
    color: var(--fso-text);
    font-family: var(--fso-font);
    font-size: 16px;
    line-height: 1.5;
    -webkit-font-smoothing: antialiased;
    -webkit-text-size-adjust: 100%;
    overflow: hidden;
}
.fso *, .fso *::before, .fso *::after { box-sizing: border-box; }
.fso :focus-visible { outline: 2px solid var(--fso-world); outline-offset: 2px; }

/* the stage: backdrop, the world, the vignette, the labels, the flash */
.fso-stage { position: absolute; inset: 0; pointer-events: none; overflow: hidden; transition: opacity 0.5s ease; }
.fso-reading .fso-stage { opacity: 0.18; }
.fso-stage > * { position: absolute; inset: 0; }
.fso-canvas { width: 100%; height: 100%; display: block; }
.fso-backdrop {
    background:
        radial-gradient(120% 70% at 50% var(--fso-cy, 40%), color-mix(in srgb, var(--fso-world) 16%, transparent) 0%, transparent 60%),
        radial-gradient(90% 60% at 85% 0%, color-mix(in srgb, var(--fso-world) 9%, transparent) 0%, transparent 70%),
        linear-gradient(180deg, var(--fso-top) 0%, var(--fso-stage) 55%, #02060e 100%);
}
.fso-vignette {
    background:
        /* a flat top edge, so it joins the status bar without a seam */
        linear-gradient(180deg, var(--fso-top) 0, color-mix(in srgb, var(--fso-top) 70%, transparent) calc(env(safe-area-inset-top) + 24px), transparent calc(env(safe-area-inset-top) + 120px)),
        radial-gradient(130% 90% at 50% 45%, transparent 55%, rgb(1 4 10 / 0.55) 100%),
        linear-gradient(0deg, rgb(3 9 20 / 0.92) 0%, rgb(3 9 20 / 0.6) 30%, transparent 55%);
}
.fso-world-label {
    position: absolute;
    left: 0;
    top: 0;
    white-space: nowrap;
    border-radius: 999px;
    padding: 2px 8px;
    font-family: var(--fso-mono);
    font-size: 11px;
    line-height: 16px;
    border: 1px solid var(--fso-line);
    background: var(--fso-card);
    color: var(--fso-text);
    -webkit-backdrop-filter: blur(8px);
    backdrop-filter: blur(8px);
    will-change: transform, opacity;
}
.fso-world-label-project { background: var(--fso-world); border-color: transparent; color: #fff; font-weight: 600; }
.fso-flash {
    position: absolute;
    inset: 0;
    background: radial-gradient(circle at 50% var(--fso-cy, 40%), rgb(255 255 255 / 0.9) 0%, var(--fso-world) 18%, transparent 62%);
    animation: fso-flash 1.4s ease-out both;
}
@keyframes fso-flash { 0% { opacity: 0; } 8% { opacity: 0.85; } 100% { opacity: 0; } }
.fso-shockwave {
    position: absolute;
    left: 50%;
    top: var(--fso-cy, 40%);
    width: 40px;
    height: 40px;
    margin: -20px 0 0 -20px;
    border-radius: 50%;
    border: 2px solid color-mix(in srgb, var(--fso-world) 70%, white);
    box-shadow: 0 0 24px var(--fso-world), inset 0 0 24px var(--fso-world);
    animation: fso-shockwave 1.5s cubic-bezier(0.1, 0.7, 0.2, 1) both;
}
@keyframes fso-shockwave { from { transform: scale(0.2); opacity: 1; } to { transform: scale(30); opacity: 0; } }

.fso-header {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    min-height: 56px;
    padding: env(safe-area-inset-top) max(16px, env(safe-area-inset-right)) 0 max(16px, env(safe-area-inset-left));
    flex-shrink: 0;
}
.fso-brand { display: inline-flex; align-items: center; justify-content: center; min-width: 44px; min-height: 44px; margin-left: -11px; color: var(--fso-text); opacity: 0.45; -webkit-tap-highlight-color: transparent; }
.fso-brand:hover { opacity: 0.7; }
.fso-brand svg { width: 22px; height: 26px; }

.fso-scroll {
    position: relative;
    flex: 1;
    overflow-x: hidden;
    overflow-y: auto;
    touch-action: pan-y;
    -webkit-overflow-scrolling: touch;
    overscroll-behavior: contain;
}
.fso-main {
    display: flex;
    flex-direction: column;
    min-height: 100%;
    min-width: 0;
    max-width: 560px;
    margin: 0 auto;
    padding: 0 max(16px, env(safe-area-inset-right)) 8px max(16px, env(safe-area-inset-left));
}
/* the world shows through the sky; the words sit at the bottom */
.fso-sky { position: relative; flex: 1 0 34vh; min-height: 160px; }
.fso-words { position: relative; min-width: 0; overflow-wrap: break-word; text-shadow: 0 1px 2px rgb(0 0 0 / 0.5), 0 0 28px rgb(0 0 0 / 0.6); }

.fso h1 {
    font-size: 30px;
    line-height: 1.15;
    letter-spacing: -0.02em;
    margin: 0 0 8px;
}
.fso p { margin: 0 0 12px; }
.fso-tagline { font-size: 20px; font-weight: 600; letter-spacing: -0.01em; color: color-mix(in srgb, var(--fso-world) 70%, white); }
.fso-lead { font-size: 17px; }
.fso-sub { color: var(--fso-muted); }
.fso-hint { color: var(--fso-muted); font-size: 15px; }
.fso-meta { color: var(--fso-dim); font-family: var(--fso-mono); font-size: 12px; }
.fso-note { color: var(--fso-muted); font-size: 14px; }
.fso-note:empty { display: none; }

.fso-eyebrow {
    margin: 0 0 8px;
    font-family: var(--fso-mono);
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.22em;
    text-transform: uppercase;
    color: color-mix(in srgb, var(--fso-world) 60%, white);
}
.fso-big { display: grid; font-size: 25px; font-weight: 650; line-height: 1.2; letter-spacing: -0.02em; text-wrap: balance; }
/* the build's titles share one cell: the tallest sizes it, one shows */
.fso-big > span { grid-area: 1 / 1; visibility: hidden; }
.fso-big > span[data-current] { visibility: visible; }
.fso-small { color: var(--fso-muted); font-size: 16px; }
.fso-small:empty { display: none; }
.fso-steps-bar { display: flex; gap: 6px; margin: 0 0 14px; }
.fso-seg { flex: 1; height: 3px; border-radius: 99px; background: var(--fso-line); overflow: hidden; }
.fso-seg-fill { display: block; height: 100%; width: 0; background: var(--fso-world); box-shadow: 0 0 10px var(--fso-world); }

.fso-source-chip { position: absolute; inset: 8px 0 auto 0; }
.fso-chip {
    position: absolute;
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 4px 10px;
    border-radius: 999px;
    border: 1px solid var(--fso-line);
    background: var(--fso-card);
    font-family: var(--fso-mono);
    font-size: 12px;
    -webkit-backdrop-filter: blur(8px);
    backdrop-filter: blur(8px);
    animation: fso-in 0.9s cubic-bezier(0.2, 0.8, 0.2, 1) both;
}
.fso-chip-left { left: 0; }
.fso-chip-right { right: 0; }
.fso-chip i {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--fso-world);
    box-shadow: 0 0 8px var(--fso-world);
    animation: fso-blink 1.2s ease-in-out infinite;
}
@keyframes fso-blink { 50% { opacity: 0.3; } }

.fso-in { animation: fso-in 0.9s cubic-bezier(0.2, 0.8, 0.2, 1) both; }
.fso-in-late { animation: fso-in 0.9s 0.25s cubic-bezier(0.2, 0.8, 0.2, 1) both; }
@keyframes fso-in { from { opacity: 0; transform: translateY(12px); filter: blur(6px); } to { opacity: 1; transform: none; filter: none; } }

.fso-notice {
    display: flex;
    gap: 12px;
    align-items: flex-start;
    padding: 12px 14px;
    margin: 0 0 12px;
    border-radius: var(--fso-radius);
    border: 1px solid var(--fso-line);
    background: var(--fso-card);
}
.fso-notice .fso-icon { color: var(--fso-muted); flex-shrink: 0; }
.fso-notice p { margin: 0; }

.fso-details { margin: 4px 0 0; text-shadow: none; min-width: 0; animation: fso-in 0.5s cubic-bezier(0.2, 0.8, 0.2, 1) both; }
.fso-details[hidden] { display: none; }
/* the record: one section per step, kept for the whole build */
.fso-record { margin: 0 0 14px; }
.fso-record h3 {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin: 0 0 6px;
    font-family: var(--fso-mono);
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: color-mix(in srgb, var(--fso-world) 60%, white);
}
.fso-record-done { display: inline-flex; align-items: center; gap: 4px; min-width: 0; font-weight: 400; letter-spacing: 0; text-transform: none; color: var(--fso-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.fso-record-done .fso-icon { width: 14px; height: 14px; flex-shrink: 0; color: var(--fso-success); }
.fso-record pre[hidden] { display: none; }
.fso-details pre { max-height: none; }
.fso pre {
    margin: 0;
    padding: 12px;
    background: rgb(0 0 0 / 0.45);
    border: 1px solid var(--fso-line);
    border-radius: 10px;
    font-family: var(--fso-mono);
    font-size: 12px;
    line-height: 1.5;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    max-height: 32vh;
    overflow: auto;
    user-select: text;
    -webkit-user-select: text;
    text-shadow: none;
}

.fso-code {
    margin: 4px 0 8px;
    border: 1px solid var(--fso-line);
    border-radius: var(--fso-radius);
    background: rgb(0 0 0 / 0.5);
    overflow: hidden;
    text-shadow: none;
    -webkit-backdrop-filter: blur(8px);
    backdrop-filter: blur(8px);
}
.fso-code figcaption {
    display: flex;
    justify-content: space-between;
    gap: 8px;
    padding: 8px 12px;
    border-bottom: 1px solid var(--fso-line);
    font-family: var(--fso-mono);
    font-size: 12px;
}
.fso-code-file { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.fso-code-legend { display: flex; gap: 10px; color: var(--fso-muted); flex-shrink: 0; }
.fso-code-legend span::before {
    content: "";
    display: inline-block;
    width: 7px;
    height: 7px;
    margin-right: 5px;
    border-radius: 50%;
    background: var(--fso-api);
}
.fso-api-node { --fso-api: #4ade80; }
.fso-api-browser { --fso-api: #38bdf8; }
.fso-code-lines { padding: 6px 0; font-family: var(--fso-mono); font-size: 12px; line-height: 1.7; }
.fso-code-line { display: flex; border-left: 3px solid var(--fso-api); padding: 0 12px 0 10px; }
.fso-code-line code { min-width: 0; white-space: pre; overflow: hidden; text-overflow: ellipsis; font: inherit; }
.fso-code-gap { padding-left: 13px; color: var(--fso-dim); line-height: 1.2; }
.fso-code p { margin: 0; padding: 8px 12px; border-top: 1px solid var(--fso-line); font-size: 13px; color: var(--fso-muted); }

.fso-actions { display: flex; flex-wrap: wrap; gap: 8px; }
.fso-button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    min-height: 48px;
    min-width: 44px;
    padding: 10px 20px;
    border-radius: 999px;
    border: 1px solid transparent;
    font: inherit;
    font-weight: 600;
    cursor: pointer;
    touch-action: manipulation;
    -webkit-tap-highlight-color: transparent;
    text-shadow: none;
}
.fso-button:disabled { opacity: 0.55; cursor: default; }
.fso-button-primary { background: var(--fso-world); color: var(--fso-accent-text); }
.fso-button-secondary { background: rgb(255 255 255 / 0.06); color: var(--fso-text); border-color: var(--fso-line); -webkit-backdrop-filter: blur(8px); backdrop-filter: blur(8px); }
.fso-button-text { background: transparent; color: var(--fso-text); padding-left: 12px; padding-right: 12px; }
.fso-button .fso-icon { width: 20px; height: 20px; flex-shrink: 0; }
.fso-header .fso-button { min-height: 44px; color: var(--fso-muted); }

/* a side action, in the tone of Show details: Finish stays the one blue */
.fso-open-demo {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 14px;
    width: 100%;
    /* grouped, not evened out: the capsule is the headline's action, so it
       sits close under it (~22 px from the baseline; the h1's margin
       collapses into this one), and the button row, the same bar on every
       screen, stands apart (~34 px: 16 + 8 for .fso-main + 10 for
       .fso-nav) */
    margin: 16px 0 16px;
    padding: 14px 22px 14px 24px;
    border: 1px solid var(--fso-line);
    border-radius: 999px;
    background: rgb(255 255 255 / 0.06);
    -webkit-backdrop-filter: blur(8px);
    backdrop-filter: blur(8px);
    color: var(--fso-text);
    font: inherit;
    text-align: left;
    cursor: pointer;
    touch-action: manipulation;
    -webkit-tap-highlight-color: transparent;
    text-shadow: none;
}
.fso-open-demo .fso-icon { width: 22px; height: 22px; flex-shrink: 0; color: color-mix(in srgb, var(--fso-world) 70%, white); }
.fso-open-demo-text { display: flex; flex-direction: column; gap: 1px; }
.fso-open-demo strong { font-size: 18px; }
.fso-open-demo-text span { font-size: 14px; color: var(--fso-muted); }

.fso-nav {
    position: relative;
    display: flex;
    align-items: center;
    gap: 12px;
    width: 100%;
    max-width: 680px;
    margin: 0 auto;
    padding: 10px max(16px, env(safe-area-inset-right)) max(14px, env(safe-area-inset-bottom)) max(16px, env(safe-area-inset-left));
    flex-shrink: 0;
}
.fso-nav .fso-button { min-height: 52px; padding: 10px 18px; font-size: 17px; white-space: nowrap; flex-shrink: 0; }
.fso-nav-spacer { flex: 1; }
.fso-nav .fso-nav-side { min-width: 0; flex-shrink: 1; }
.fso-nav-side span { overflow: hidden; text-overflow: ellipsis; }

.fso-icon { display: inline-flex; width: 24px; height: 24px; }
.fso-icon svg { width: 100%; height: 100%; }


/* the smallest phones: both nav buttons fit, without the icon */
@media (max-width: 359px) {
    .fso-nav { gap: 8px; }
    .fso-nav .fso-button { padding: 10px 14px; font-size: 15px; }
    .fso-nav-side .fso-icon { display: none; }
}
@media (min-width: 640px) {
    .fso h1 { font-size: 38px; }
    .fso-open-demo { margin-top: 13px; } /* the larger h1 ends further below its baseline */
    .fso-big { font-size: 30px; }
}
@media (prefers-reduced-motion: reduce) {
    .fso-in, .fso-in-late, .fso-chip { animation: fso-fade 0.3s ease-out both; }
    .fso-chip i { animation: none; }
    .fso.fso-settled { transition: none; }
}
@keyframes fso-fade { from { opacity: 0; } }
`;
