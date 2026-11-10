// A small DOM helper: the onboarding has no UI framework, so it stays light
// inside the app's shell page.

export type Child = Node | string | number | false | null | undefined | Child[];

type Props = {
    class?: string;
    text?: string;
    html?: string; // trusted markup only (the icons below)
    [attribute: string]: unknown;
};

export function h<K extends keyof HTMLElementTagNameMap>(
    tag: K,
    props?: Props | null,
    ...children: Child[]
): HTMLElementTagNameMap[K] {
    const el = document.createElement(tag);
    for (const [key, value] of Object.entries(props ?? {})) {
        if (value === undefined || value === null || value === false) continue;
        if (key === "class") el.className = String(value);
        else if (key === "text") el.textContent = String(value);
        else if (key === "html") el.innerHTML = String(value);
        else if (key.startsWith("on") && typeof value === "function") {
            el.addEventListener(
                key.slice(2).toLowerCase(),
                value as EventListener
            );
        } else el.setAttribute(key, value === true ? "" : String(value));
    }
    append(el, children);
    return el;
}

function append(el: Node, children: Child[]) {
    for (const child of children) {
        if (child === null || child === undefined || child === false) continue;
        if (Array.isArray(child)) append(el, child);
        else
            el.appendChild(
                child instanceof Node
                    ? child
                    : document.createTextNode(String(child))
            );
    }
}

export function button(
    label: Child,
    onClick: () => void,
    variant: "primary" | "secondary" | "text" = "secondary",
    extra?: Props
) {
    return h(
        "button",
        {
            type: "button",
            class: `fso-button fso-button-${variant}`,
            onclick: onClick,
            ...extra
        },
        label
    );
}

// Icons: 24x24, stroke with currentColor
const svg = (body: string) =>
    `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

export const icons = {
    check: svg('<path d="M5 12.5l4.5 4.5L19 7.5"/>'),
    cross: svg('<path d="M6 6l12 12M18 6L6 18"/>'),
    pending: svg('<circle cx="12" cy="12" r="8"/>'),
    folder: svg(
        '<path d="M3 7.5A1.5 1.5 0 0 1 4.5 6h4l2 2h9A1.5 1.5 0 0 1 21 9.5v8a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5z"/>'
    ),
    file: svg(
        '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/>'
    ),
    back: svg('<path d="M15 18l-6-6 6-6"/>'),
    arrowLeft: svg('<path d="M19 12H6M11 6l-6 6 6 6"/>'),
    arrowRight: svg('<path d="M5 12h13M13 6l6 6-6 6"/>'),
    external: svg(
        '<path d="M14 4h6v6"/><path d="M20 4l-9 9"/><path d="M19 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h4"/>'
    ),
    offline: svg(
        '<path d="M2 8.8a15 15 0 0 1 4.2-2.6M10.7 5.1A15 15 0 0 1 22 8.8M5 12.5a10 10 0 0 1 5.2-2.7M16.4 10.6a10 10 0 0 1 2.6 1.9M8.5 16a5 5 0 0 1 7 0M12 20h.01M3 3l18 18"/>'
    )
};

export function icon(name: keyof typeof icons, className = "") {
    return h("span", {
        class: `fso-icon ${className}`.trim(),
        html: icons[name]
    });
}
