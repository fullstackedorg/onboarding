// Standalone development page: `npm start` runs the onboarding on its own,
// with dev/ as the projects folder (the demo is cloned to dev/demo).
//
//   ?offline     behave as if there was no network
//   ?dir=<name>  clone the demo to <name> instead of demo

import { startOnboarding, type OnboardingStats } from "../src";

const params = new URLSearchParams(location.search);

document.title = "FullStacked onboarding (dev)";
document.head.append(
    Object.assign(document.createElement("style"), {
        textContent: `:root { color-scheme: light dark; font-family: system-ui, sans-serif; }
body { margin: 0; padding: 16px; }
pre { white-space: pre-wrap; font-size: 12px; }
button { min-height: 44px; padding: 0 16px; font: inherit; }`
    })
);

function start() {
    const el = document.createElement("div");
    document.body.replaceChildren(el);
    startOnboarding(el, {
        offline: params.has("offline"),
        cloneDir: params.get("dir") || undefined,
        onDone: (stats) => {
            el.remove();
            done(stats);
        }
    });
}

// In the app, onDone opens the terminal. Here: what it received.
function done(stats: OnboardingStats) {
    const again = document.createElement("button");
    again.textContent = "Start again";
    again.onclick = start;
    const pre = document.createElement("pre");
    pre.textContent = JSON.stringify(stats, null, 2);
    const title = document.createElement("h1");
    title.textContent = `onDone: ${stats.outcome}`;
    document.body.replaceChildren(title, again, pre);
}

start();
