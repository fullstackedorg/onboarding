// What the build plugin (../index.ts) adds to the app's shell: the open-source
// startup. On first launch the onboarding, then the terminal; afterwards the
// terminal directly.
//
// The shell holds its terminal while a startup script runs and hands it
// `openTerminal` (see README, "In the app's shell").

import { shouldRunOnboarding, startOnboarding } from "./index";

export type ShellStartup = {
    held?: boolean;
    openTerminal: () => unknown;
};

export default async function startup(shell: ShellStartup) {
    if (!(await shouldRunOnboarding())) {
        shell.openTerminal();
        return;
    }
    const el = document.createElement("div");
    document.body.append(el);
    startOnboarding(el, {
        continueLabel: "Open the terminal",
        onDone: () => {
            el.remove();
            shell.openTerminal();
        }
    });
}
