// The FullStacked world: the particle animation of the build, drawn while
// it happens. Ported from github.com/fullstackedorg/demo (a THREE.Points
// cloud) to plain WebGL, so the onboarding keeps no dependency.
//
// One draw call. Every particle carries all its formations as attributes
// (where it comes from, the repository, its package cluster, the core, the
// world); the vertex shader blends between them from a handful of uniforms.
// Per frame, the CPU only advances a few tweens, moves the camera and writes
// uniforms.

import { vertexShader, fragmentShader } from "./shaders";
import {
    lookAtOrigin,
    multiply,
    perspective,
    project,
    type Mat4,
    type Vec3
} from "./mat4";
import { Governor } from "./governor";

export type Cluster = { name: string; bytes: number };

export type WorldOptions = {
    canvas: HTMLCanvasElement;
    labels: HTMLElement; // layer for the package labels
    gitObjects: number;
    clusters: Cluster[]; // packages, biggest first
    projectName: string;
    color: string;
    reducedMotion: boolean;
    // the frame-rate governor stepped to another quality (governor.ts)
    onQuality?: (level: number, lite: boolean) => void;
};

export type Ease = "linear" | "inOut" | "out";
const EASES: Record<Ease, (t: number) => number> = {
    linear: (t) => t,
    inOut: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
    out: (t) => 1 - Math.pow(1 - t, 3)
};

type Tween = {
    from: number | null; // taken when the tween starts
    to: number;
    start: number;
    duration: number;
    ease: (t: number) => number;
    done?: () => void;
};

const CHANNELS = [
    "uIntro",
    "uStream",
    "uPkg",
    "uCore",
    "uWorld",
    "uIgnite",
    "uLeave",
    "uLabels",
    // the camera: the radius of the sphere it frames, its elevation and
    // its turn around the world, in radians
    "uFrame",
    "uElev",
    "uAzim"
] as const;
export type Channel = (typeof CHANNELS)[number];

const MAX_PARTICLES = 2600;
const LOW_END_PARTICLES = 1600;
const MAX_GIT_PARTICLES = 700;
const GLOWS = 4;
const FOV = 50;
// the world's height (planet, tilted ring, moons, seen from uElev) as a share
// of the radius that frames its width
const WORLD_HEIGHT = 0.72;
// how long the world takes to follow a new area (as long as --fso-cy's
// transition in styles.ts)
export const AREA_SECONDS = 0.9;

// the shader works in linear light, like THREE.Color did
function linearColor(hex: string): Vec3 {
    const n = parseInt(hex.replace("#", "").slice(0, 6), 16) || 0x219ef2;
    const c = (v: number) => {
        v /= 255;
        return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    };
    return [c((n >> 16) & 255), c((n >> 8) & 255), c(n & 255)];
}

// WebGL may be missing (old devices, blocked GPU): the onboarding works
// without its world
export function createWorld(opts: WorldOptions): World | null {
    try {
        return new World(opts);
    } catch (e) {
        console.warn("onboarding: no WebGL, no animation", e);
        return null;
    }
}

export class World {
    private gl: WebGLRenderingContext;
    private program: WebGLProgram;
    private buffers: WebGLBuffer[] = [];
    private locations: Record<string, WebGLUniformLocation | null> = {};
    private values: Record<Channel, number> = {
        uIntro: 0,
        uStream: 0,
        uPkg: 0,
        uCore: 0,
        uWorld: 0,
        uIgnite: 0,
        uLeave: 0,
        uLabels: 0,
        uFrame: 1.3,
        uElev: 0.12,
        uAzim: 0
    };
    private color: Vec3;
    private tweens = new Map<Channel, Tween>();
    private clusterCenters: Vec3[] = [];
    private clusterRadii: number[] = [];
    private labelWidths: number[] = [];
    private labelEls: HTMLElement[] = [];
    private rafId = 0;
    private last = performance.now();
    private elapsed = 0;
    private spin = 0;
    private governor: Governor;
    private count: number;
    private drawCount: number;
    private ro: ResizeObserver;
    private disposed = false;
    private pixelRatio = 1;
    private width = 1;
    private height = 1;
    // the part of the screen the world is framed in, in pixels from the top;
    // a new one is eased to (the words change size between screens), never
    // jumped to
    private area = { top: 0, bottom: 0 };
    private areaMove: {
        from: { top: number; bottom: number };
        to: { top: number; bottom: number };
        start: number;
    } | null = null;
    private areaHeight = 1;
    private offsetY = 0;
    private viewProjection: Mat4 = new Float32Array(16);

    constructor(private opts: WorldOptions) {
        const gl = opts.canvas.getContext("webgl", {
            alpha: true,
            antialias: false,
            premultipliedAlpha: true,
            powerPreference: "high-performance"
        });
        if (!gl) throw new Error("WebGL is not available");
        this.gl = gl;
        this.color = linearColor(opts.color);

        const lowEnd =
            (navigator.hardwareConcurrency || 8) <= 4 ||
            ((navigator as any).deviceMemory || 8) <= 3;
        this.count = lowEnd ? LOW_END_PARTICLES : MAX_PARTICLES;
        this.drawCount = this.count;
        this.governor = new Governor((level) => {
            const q = this.governor.quality;
            this.drawCount = Math.floor(this.count * q.particles);
            this.resize();
            console.debug(
                `onboarding: quality ${level} at ${Math.round(this.governor.fps)} fps`
            );
            this.opts.onQuality?.(level, q.lite);
        });

        this.program = this.compile();
        this.buildParticles();
        this.buildLabels();

        this.ro = new ResizeObserver(this.resize);
        this.ro.observe(opts.canvas);
        this.resize();
        document.addEventListener("visibilitychange", this.onVisibility);
        this.rafId = requestAnimationFrame(this.frame);
    }

    private compile() {
        const gl = this.gl;
        const shader = (type: number, source: string) => {
            const s = gl.createShader(type)!;
            gl.shaderSource(s, source);
            gl.compileShader(s);
            if (!gl.getShaderParameter(s, gl.COMPILE_STATUS))
                throw new Error(gl.getShaderInfoLog(s) || "shader error");
            return s;
        };
        const program = gl.createProgram()!;
        gl.attachShader(program, shader(gl.VERTEX_SHADER, vertexShader));
        gl.attachShader(program, shader(gl.FRAGMENT_SHADER, fragmentShader));
        gl.linkProgram(program);
        if (!gl.getProgramParameter(program, gl.LINK_STATUS))
            throw new Error(gl.getProgramInfoLog(program) || "link error");
        gl.useProgram(program);
        for (const name of [
            ...CHANNELS,
            "uTime",
            "uSize",
            "uViewport",
            "uCamDist",
            "uColor",
            "uStill",
            "uSpin",
            "modelViewMatrix",
            "projectionMatrix"
        ])
            this.locations[name] = gl.getUniformLocation(program, name);
        // light on a deep background: colors add up into a glow
        gl.disable(gl.DEPTH_TEST);
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
        gl.clearColor(0, 0, 0, 0);
        return program;
    }

    private attribute(name: string, data: Float32Array, size: number) {
        const gl = this.gl;
        const location = gl.getAttribLocation(this.program, name);
        const buffer = gl.createBuffer()!;
        this.buffers.push(buffer);
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
        if (location < 0) return; // optimized out
        gl.enableVertexAttribArray(location);
        gl.vertexAttribPointer(location, size, gl.FLOAT, false, 0, 0);
    }

    // ── Formations ──────────────────────────────────────────────────────────

    private buildParticles() {
        const { gitObjects, clusters } = this.opts;
        const n = this.count;
        // in this order, so that dropping the end (when the device can't
        // keep up) only removes package particles
        const stars = Math.round(n * 0.12);
        const firstFormation = GLOWS + stars;
        const formation = n - firstFormation;
        const git = Math.min(
            gitObjects,
            MAX_GIT_PARTICLES,
            Math.floor(formation / 3)
        );

        const meta = new Float32Array(n * 4);
        const from = new Float32Array(n * 3);
        const repo = new Float32Array(n * 3);
        const center = new Float32Array(n * 3);
        const offset = new Float32Array(n * 3);
        const core = new Float32Array(n * 3);
        const world = new Float32Array(n * 4);

        // Cluster 0 is the project's own source, in the middle; the packages
        // sit around it on a circle, sized by their download.
        const weights = clusters.map((c) => Math.sqrt(Math.max(c.bytes, 1)));
        const total = weights.reduce((a, b) => a + b, 0) || 1;
        const centers: Vec3[] = [[0, 0, 0]];
        const radii = [0.42];
        clusters.forEach((_, i) => {
            const a = Math.PI / 2 + ((i + 0.5) / clusters.length) * Math.PI * 2;
            centers.push([
                Math.cos(a) * 1.4,
                Math.sin(a) * 1.4,
                Math.sin(a * 2) * 0.25
            ]);
            radii.push(0.12 + 0.36 * Math.cbrt(weights[i] / total));
        });
        this.clusterCenters = centers;
        this.clusterRadii = radii;
        // particles per cluster: by weight, with a floor so that a tiny
        // package still reads as a cluster
        const maxWeight = Math.max(...weights, 1);
        const shares = weights.map((w) => Math.max(w, maxWeight * 0.3));
        const shareTotal = shares.reduce((a, b) => a + b, 0) || 1;
        const cumulative: number[] = [];
        shares.reduce((acc, w, i) => (cumulative[i] = acc + w / shareTotal), 0);

        const v: Vec3 = [0, 0, 0];
        const length = () => Math.hypot(v[0], v[1], v[2]);
        const setLength = (l: number) => {
            const k = l / (length() || 1);
            v[0] *= k;
            v[1] *= k;
            v[2] *= k;
        };
        const inSphere = (r: number, bias = 1) => {
            do {
                v[0] = Math.random() * 2 - 1;
                v[1] = Math.random() * 2 - 1;
                v[2] = Math.random() * 2 - 1;
            } while (length() > 1 || length() < 1e-3);
            // bias > 1 packs the points toward the middle
            setLength(r * Math.pow(length(), bias));
        };
        const golden = Math.PI * (3 - Math.sqrt(5));
        const side = Math.ceil(Math.cbrt(Math.max(git, 1)));
        const step = 1.75 / Math.max(1, side - 1);
        const spheres = Math.ceil((formation * 9) / 20);
        let sphereIndex = 0;

        for (let i = 0; i < n; i++) {
            const k3 = i * 3,
                k4 = i * 4;
            const seed = Math.random();
            const tint = Math.random();

            if (i < GLOWS) {
                meta.set([3, i / Math.max(1, GLOWS - 1), tint, 0], k4);
                continue;
            }
            if (i < firstFormation) {
                // a star, far away on a shell around everything
                inSphere(1);
                setLength(9 + Math.random() * 9);
                meta.set([2, seed, Math.pow(tint, 2.5), 0], k4);
                from.set(v, k3);
                continue;
            }

            const j = i - firstFormation;
            const isGit = j < git;
            let c = 0;
            if (!isGit) {
                const r = Math.random();
                c =
                    1 +
                    Math.max(
                        0,
                        cumulative.findIndex((x) => r <= x)
                    );
            }
            meta.set(
                [isGit ? 0 : 1, seed, tint, c / Math.max(1, clusters.length)],
                k4
            );

            // where it comes from: GitHub top left, the npm registry top right
            from.set(
                [
                    (isGit ? -4.5 : 4.5) + (Math.random() - 0.5) * 0.8,
                    5.2 + (Math.random() - 0.5) * 0.8,
                    -2.5 + (Math.random() - 0.5) * 0.8
                ],
                k3
            );

            // the repository: a lattice of git objects, a box of files
            if (isGit) {
                const gx = j % side,
                    gy = Math.floor(j / side) % side,
                    gz = Math.floor(j / side / side);
                repo.set(
                    [
                        (gx - (side - 1) / 2) * step,
                        (gy - (side - 1) / 2) * step,
                        (gz - (side - 1) / 2) * step
                    ],
                    k3
                );
            }

            // its cluster
            center.set(centers[Math.min(c, centers.length - 1)], k3);
            inSphere(radii[Math.min(c, radii.length - 1)], 1.4);
            offset.set(v, k3);

            // the core: small, dense in the middle
            inSphere(0.26, 1.8);
            core.set(v, k3);

            // the world: 45 % planet, 40 % ring, 15 % moons
            const slot = j % 20;
            if (slot < 9 && sphereIndex < spheres) {
                const s = sphereIndex++;
                const y = 1 - (2 * (s + 0.5)) / spheres;
                const r = Math.sqrt(1 - y * y);
                const th = golden * s;
                const jitter = 1 + (Math.random() - 0.5) * 0.03;
                world.set(
                    [
                        Math.cos(th) * r * jitter,
                        y * jitter,
                        Math.sin(th) * r * jitter,
                        0
                    ],
                    k4
                );
            } else if (slot < 17) {
                // denser toward the inside, with a gap like a planet's rings
                let r = 1.45 + Math.pow(Math.random(), 1.4) * 0.95;
                if (r > 1.86 && r < 1.94) r += 0.1;
                world.set(
                    [
                        r,
                        (Math.random() - 0.5) * 0.025,
                        Math.random() * Math.PI * 2,
                        1
                    ],
                    k4
                );
            } else {
                world.set(
                    [
                        1.15 + Math.random() * 0.35,
                        (Math.random() - 0.5) * 2.2,
                        Math.random() * Math.PI * 2,
                        2
                    ],
                    k4
                );
            }
        }

        this.attribute("position", repo, 3);
        this.attribute("aMeta", meta, 4);
        this.attribute("aFrom", from, 3);
        this.attribute("aCenter", center, 3);
        this.attribute("aOffset", offset, 3);
        this.attribute("aCore", core, 3);
        this.attribute("aWorld", world, 4);
    }

    private buildLabels() {
        const layer = this.opts.labels;
        layer.replaceChildren();
        const names = [
            this.opts.projectName,
            ...this.opts.clusters.map((c) => c.name)
        ];
        this.labelEls = names.map((name, i) => {
            const el = document.createElement("div");
            el.textContent = name;
            el.className =
                "fso-world-label" + (i === 0 ? " fso-world-label-project" : "");
            el.style.opacity = "0";
            layer.append(el);
            return el;
        });
    }

    // ── Animation API ───────────────────────────────────────────────────────

    animate(
        channel: Channel,
        to: number,
        seconds: number,
        opts: { delay?: number; ease?: Ease; done?: () => void } = {}
    ) {
        if (this.opts.reducedMotion || seconds <= 0) {
            this.tweens.delete(channel);
            this.values[channel] = to;
            opts.done?.();
            return;
        }
        this.tweens.set(channel, {
            from: null,
            to,
            start: performance.now() + (opts.delay || 0) * 1000,
            duration: seconds * 1000,
            ease: EASES[opts.ease || "inOut"],
            done: opts.done
        });
    }

    // one move after the other on the same channel
    sequence(
        channel: Channel,
        steps: [to: number, seconds: number, ease?: Ease][],
        delay = 0
    ) {
        const [first, ...rest] = steps;
        if (!first) return;
        this.animate(channel, first[0], first[1], {
            delay,
            ease: first[2],
            done: () => this.sequence(channel, rest)
        });
    }

    get(channel: Channel) {
        const tween = this.tweens.get(channel);
        return tween ? tween.to : this.values[channel];
    }

    set(channel: Channel, value: number) {
        this.tweens.delete(channel);
        this.values[channel] = value;
    }

    // follow a value that moves on its own (the build's progress), smoothly
    follow(channel: Channel, value: number) {
        if (this.tweens.has(channel)) this.tweens.delete(channel);
        this.values[channel] = value;
    }

    // frame the world between two lines of the screen (above the words):
    // the first time at once, then eased over AREA_SECONDS, like --fso-cy
    setArea(top: number, bottom: number) {
        const to = { top, bottom };
        const target = this.areaMove?.to ?? this.area;
        if (to.top === target.top && to.bottom === target.bottom) return;
        if (!this.area.bottom || this.opts.reducedMotion) {
            this.areaMove = null;
            this.area = to;
            this.frameArea();
            return;
        }
        this.areaMove = {
            from: { ...this.area },
            to,
            start: performance.now()
        };
    }

    // a quick flash: 0 → 1 → 0
    ignite() {
        if (this.opts.reducedMotion) return;
        this.sequence("uIgnite", [
            [1, 0.12, "out"],
            [0, 1.1, "out"]
        ]);
    }

    stats() {
        return {
            fps: Math.round(this.governor.fps),
            level: this.governor.level,
            locked: this.governor.locked,
            particles: this.drawCount,
            pixelRatio: this.pixelRatio
        };
    }

    // Draws hidden until the frame rate has settled (the shaders compiled,
    // the governor done stepping down), or for maxSeconds at most: the
    // splash waits on it, so the world appears at a rate it can hold.
    warmup(maxSeconds: number): Promise<void> {
        const governor = this.governor;
        governor.warming = true;
        const until = performance.now() + maxSeconds * 1000;
        return new Promise((resolve) => {
            const check = () => {
                if (
                    this.disposed ||
                    governor.settled ||
                    performance.now() >= until
                ) {
                    governor.warming = false;
                    resolve();
                } else setTimeout(check, 50);
            };
            check();
        });
    }

    // ── Loop ────────────────────────────────────────────────────────────────

    // the projection's shift and the area's share of the height
    private frameArea() {
        const h = this.height;
        const top = this.area.top || 0;
        const bottom = this.area.bottom || h;
        this.offsetY = h / 2 - (top + bottom) / 2;
        this.areaHeight = Math.max(0.2, (bottom - top) / h);
    }

    private moveArea(now: number) {
        const move = this.areaMove;
        if (!move) return;
        const t = Math.min(1, (now - move.start) / (AREA_SECONDS * 1000));
        const e = EASES.inOut(t);
        this.area = {
            top: move.from.top + (move.to.top - move.from.top) * e,
            bottom: move.from.bottom + (move.to.bottom - move.from.bottom) * e
        };
        if (t >= 1) this.areaMove = null;
        this.frameArea();
    }

    private resize = () => {
        const canvas = this.opts.canvas;
        const w = canvas.clientWidth || window.innerWidth;
        const h = canvas.clientHeight || window.innerHeight;
        this.pixelRatio = Math.min(
            window.devicePixelRatio || 1,
            this.governor.quality.pixelRatio
        );
        this.width = w;
        this.height = h;
        canvas.width = Math.round(w * this.pixelRatio);
        canvas.height = Math.round(h * this.pixelRatio);
        this.gl.viewport(0, 0, canvas.width, canvas.height);
        // shift the projection so the origin sits in the middle of the area
        this.frameArea();
    };

    private onVisibility = () => {
        cancelAnimationFrame(this.rafId);
        if (!document.hidden && !this.disposed) {
            this.last = performance.now();
            this.rafId = requestAnimationFrame(this.frame);
        }
    };

    private frame = (now: number) => {
        if (this.disposed) return;
        this.rafId = requestAnimationFrame(this.frame);
        const dtMs = now - this.last;
        this.last = now;
        const dt = Math.min(dtMs / 1000, 0.1);
        this.elapsed += dt;
        this.measure(dtMs);

        // tweens → values
        for (const [channel, tw] of this.tweens) {
            const t = (now - tw.start) / tw.duration;
            if (t < 0) continue;
            if (tw.from === null) tw.from = this.values[channel];
            if (t >= 1) {
                this.values[channel] = tw.to;
                this.tweens.delete(channel);
                tw.done?.();
            } else {
                this.values[channel] = tw.from + (tw.to - tw.from) * tw.ease(t);
            }
        }

        this.moveArea(now);

        // camera: far enough to frame a sphere of radius uFrame in the area,
        // on any aspect ratio, then turned by uElev and uAzim. The world is
        // flat (a planet in a ring): it only needs WORLD_HEIGHT of that
        // radius in height, so a wide screen frames it much larger.
        const still = this.opts.reducedMotion;
        const aspect = this.width / this.height;
        const half = Math.tan((FOV * Math.PI) / 360);
        const vFov = 2 * Math.atan(half * this.areaHeight);
        const hFov = 2 * Math.atan(half * aspect);
        const frame = this.values.uFrame;
        const tall = frame * (1 - (1 - WORLD_HEIGHT) * this.values.uWorld);
        const dist = Math.max(
            tall / Math.sin(vFov / 2),
            frame / Math.sin(hFov / 2)
        );
        const elev =
            this.values.uElev +
            (still ? 0 : Math.sin(this.elapsed * 0.11) * 0.03);
        const azim =
            this.values.uAzim +
            (still ? 0 : Math.sin(this.elapsed * 0.13) * 0.05);
        const eye: Vec3 = [
            Math.sin(azim) * Math.cos(elev) * dist,
            Math.sin(elev) * dist,
            Math.cos(azim) * Math.cos(elev) * dist
        ];

        // The world turns on itself while it exists. The turn is the world's
        // own (uSpin, in the shader): the build's shapes (the stream, the
        // clusters, the core) always face the camera, so when the world
        // comes apart nothing has to turn back to the front.
        if (!still)
            this.spin =
                (this.spin + dt * 0.12 * this.values.uWorld) % (2 * Math.PI);

        const proj = perspective(
            FOV,
            aspect,
            0.05,
            100,
            this.offsetY,
            this.height
        );
        const modelView = lookAtOrigin(eye);
        this.viewProjection = multiply(proj, modelView);

        const gl = this.gl;
        const u = this.locations;
        for (const c of CHANNELS) gl.uniform1f(u[c], this.values[c]);
        gl.uniform1f(u.uTime, this.elapsed);
        gl.uniform1f(u.uSize, 0.036);
        gl.uniform1f(u.uViewport, this.height * this.pixelRatio);
        gl.uniform1f(u.uCamDist, dist);
        gl.uniform1f(u.uStill, still ? 1 : 0);
        gl.uniform1f(u.uSpin, this.spin);
        gl.uniform3fv(u.uColor, this.color);
        gl.uniformMatrix4fv(u.modelViewMatrix, false, modelView);
        gl.uniformMatrix4fv(u.projectionMatrix, false, proj);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.drawArrays(gl.POINTS, 0, this.drawCount);

        this.placeLabels();
    };

    private placeLabels() {
        const alpha = this.values.uLabels * (1 - this.values.uCore);
        const w = this.width,
            h = this.height;
        this.labelEls.forEach((el, i) => {
            if (alpha < 0.01) {
                if (el.style.opacity !== "0") el.style.opacity = "0";
                return;
            }
            // the project's label under its cluster, the packages' on the
            // outside of theirs, away from the middle
            const [cx, cy, cz] = this.clusterCenters[i] ?? [0, 0, 0];
            const r = this.clusterRadii[i] ?? 0.2;
            let p: Vec3;
            if (i === 0) p = [cx, cy - r - 0.05, cz];
            else {
                const l = Math.hypot(cx, cy) || 1;
                const k = r * 0.75 + 0.1;
                p = [cx + (cx / l) * k, cy + (cy / l) * k, cz];
            }
            const [nx, ny] = project(this.viewProjection, p);
            const halfW = (this.labelWidths[i] ||= el.offsetWidth) / 2;
            const x = Math.min(
                w - halfW - 8,
                Math.max(halfW + 8, (nx * 0.5 + 0.5) * w)
            );
            const y = (-ny * 0.5 + 0.5) * h;
            el.style.transform = `translate(${(x - halfW).toFixed(1)}px, ${y.toFixed(1)}px) translate(0, -50%)`;
            el.style.opacity = alpha.toFixed(2);
        });
    }

    // frame times go to the governor, which steps the quality down when
    // the device can't keep up (governor.ts)
    private measure(dtMs: number) {
        this.governor.frame(dtMs);
    }

    dispose() {
        this.disposed = true;
        cancelAnimationFrame(this.rafId);
        this.ro.disconnect();
        document.removeEventListener("visibilitychange", this.onVisibility);
        const gl = this.gl;
        this.buffers.forEach((b) => gl.deleteBuffer(b));
        gl.deleteProgram(this.program);
        gl.getExtension("WEBGL_lose_context")?.loseContext();
        this.opts.labels.replaceChildren();
    }
}
