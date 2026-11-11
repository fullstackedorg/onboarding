// The frame-rate governor: keeps the world smooth on whatever device it
// plays on. It aims for 60 frames a second. Over each window of frames it
// measures the rate; below 50 it steps down the quality ladder (fewer pixels
// first, then fewer particles) until the rate holds. A step that doesn't
// raise the rate means the screen itself is capped (a 30 Hz low-power mode),
// not the GPU: that step is undone and the governor stops there, so a capped
// screen keeps the full picture. Nothing of this is shown.

export type Quality = {
    pixelRatio: number; // the highest device pixel ratio drawn
    particles: number; // the share of particles drawn
    lite: boolean; // the page drops its costly effects (blurs) too
};

export const QUALITY: Quality[] = [
    { pixelRatio: 1.5, particles: 1, lite: false },
    { pixelRatio: 1.25, particles: 1, lite: false },
    { pixelRatio: 1, particles: 0.8, lite: true },
    { pixelRatio: 1, particles: 0.6, lite: true },
    { pixelRatio: 0.75, particles: 0.45, lite: true }
];

export const TARGET_FPS = 60;
// below this, a window counts as slow (a 60 Hz screen that drops a frame in
// six)
const SLOW_FPS = 50;
// a step down must raise the rate by this much to count as a gain
const GAIN = 1.08;
// frames per window: short while warming up behind the splash, then about a
// second
const WARM_WINDOW = 20;
const WINDOW = 60;
// frames left out after a change (the resize itself stutters)
const SETTLE_FRAMES = 6;

export class Governor {
    level = 0;
    fps = TARGET_FPS;
    warming = false;
    // the governor won't step any further: the rate holds, or the screen is
    // capped, or the ladder ends
    locked = false;
    // windows in a row at a good rate since warming started
    steady = 0;
    private times: number[] = [];
    private skip = SETTLE_FRAMES;
    private trial: { from: number; fps: number } | null = null;
    private onChange: (level: number) => void;

    constructor(onChange: (level: number) => void) {
        this.onChange = onChange;
    }

    get quality() {
        return QUALITY[this.level];
    }

    // settled: nothing on trial, and the rate held for two windows (or the
    // governor stopped)
    get settled() {
        return !this.trial && (this.locked || this.steady >= 2);
    }

    frame(dtMs: number) {
        // a hidden page or a long stall says nothing about the GPU
        if (dtMs <= 0 || dtMs > 250) {
            this.times = [];
            return;
        }
        if (this.skip > 0) {
            this.skip--;
            return;
        }
        this.times.push(dtMs);
        if (this.times.length < (this.warming ? WARM_WINDOW : WINDOW)) return;
        const avg = this.times.reduce((a, b) => a + b, 0) / this.times.length;
        this.times = [];
        this.fps = 1000 / avg;
        this.decide(this.fps);
    }

    private decide(fps: number) {
        const trial = this.trial;
        this.trial = null;
        if (trial && fps < trial.fps * GAIN) {
            // no gain from the last step: the screen is capped
            this.set(trial.from);
            this.locked = true;
            return;
        }
        if (this.locked) return;
        if (fps >= SLOW_FPS) {
            this.steady++;
            return;
        }
        this.steady = 0;
        if (this.level >= QUALITY.length - 1) {
            this.locked = true;
            return;
        }
        this.trial = { from: this.level, fps };
        this.set(this.level + 1);
    }

    private set(level: number) {
        if (level === this.level) return;
        this.level = level;
        this.times = [];
        this.skip = SETTLE_FRAMES;
        this.onChange(level);
    }
}
