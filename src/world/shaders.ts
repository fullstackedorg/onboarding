// Ported from github.com/fullstackedorg/demo (src/world/shaders.ts, formerly
// for THREE.ShaderMaterial): plain WebGL now, no dependency.
//
// Every particle knows all its formations; the uniforms say how far along
// each step of the story is. Each particle starts a step a little after the
// previous one (its seed), which turns one number into a stream.
//
// The glow is cheap: every point is a soft sprite (a bright center and a
// faint halo) drawn with additive blending, and a few very large, very faint
// sprites at the center make the bloom of the core. No post-processing.
export const vertexShader = /* glsl */ `
precision highp float;
// what THREE.ShaderMaterial used to declare
uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
attribute vec3 position;
attribute vec4 aMeta;     // kind (0 git object, 1 package, 2 star, 3 glow), seed, tint, cluster
attribute vec3 aFrom;     // off screen: GitHub (git) or the npm registry (packages); a star's place
attribute vec3 aCenter;   // its package cluster's center
attribute vec3 aOffset;   // its place in the cluster
attribute vec3 aCore;     // inside the bundle's core
attribute vec4 aWorld;    // on the FullStacked world: xyz + type (0 sphere, 1 ring, 2 orbit)
// position: its place in the repository (git objects)

uniform float uTime;
uniform float uIntro;     // the stars fade in
uniform float uStream;    // 1. git objects arrive
uniform float uPkg;       // 2. packages arrive, everything clusters
uniform float uCore;      // 3. clusters compress into the core
uniform float uWorld;     // 4. the core ignites into the world
uniform float uIgnite;    // flash
uniform float uSize;
uniform float uViewport;
uniform float uStill;     // reduced motion: nothing moves on its own
uniform float uCamDist;

uniform vec3 uColor;

varying vec3 vColor;
varying float vAlpha;
varying float vSoft;

const float PI = 3.14159265;

float stagger(float t, float seed, float spread) {
    return clamp(t * (1.0 + spread) - seed * spread, 0.0, 1.0);
}
float inOut(float t) {
    return t < 0.5 ? 4.0 * t * t * t : 1.0 - pow(-2.0 * t + 2.0, 3.0) / 2.0;
}
float outExpo(float t) { return t >= 1.0 ? 1.0 : 1.0 - pow(2.0, -10.0 * t); }
mat2 rot(float a) { float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }
vec3 palette(float t) {
    return 0.5 + 0.5 * cos(6.28318 * (t + vec3(0.0, 0.33, 0.67)));
}
vec3 bezier(vec3 a, vec3 b, vec3 c, float t) {
    return mix(mix(a, b, t), mix(b, c, t), t);
}

// the FullStacked world: a planet of points, a ring that orbits it, and a
// few moons on tilted orbits
vec3 worldPosition(vec4 w, float t, out vec3 normal) {
    if (w.w < 0.5) {
        normal = normalize(w.xyz);
        return w.xyz;
    }
    if (w.w < 1.5) {
        // x: radius, y: height, z: angle; inner particles orbit faster
        float a = w.z + t * 0.55 / pow(w.x, 1.5);
        vec3 p = vec3(cos(a) * w.x, w.y, sin(a) * w.x);
        p.yz = rot(-0.36) * p.yz;
        normal = vec3(0.0, 1.0, 0.0);
        return p;
    }
    // x: radius, y: inclination, z: phase
    float a = w.z + t * 0.4;
    vec3 p = vec3(cos(a) * w.x, 0.0, sin(a) * w.x);
    p.yz = rot(w.y) * p.yz;
    p.xz = rot(w.z * 3.7) * p.xz;
    normal = normalize(p);
    return p;
}

void main() {
    float kind = aMeta.x;
    float seed = aMeta.y;
    float tint = aMeta.z;
    float t = uTime * (1.0 - uStill);
    vSoft = 0.0;

    // the stars: far away, they only twinkle
    if (kind > 1.5 && kind < 2.5) {
        vec4 mv = modelViewMatrix * vec4(aFrom, 1.0);
        float twinkle = 0.55 + 0.45 * sin(t * (0.6 + seed * 1.8) + seed * 50.0);
        vColor = mix(vec3(0.75, 0.82, 1.0), mix(uColor, vec3(1.0), 0.5), step(0.8, tint));
        vAlpha = uIntro * twinkle * (0.25 + 0.75 * tint) * (1.0 - 0.6 * uIgnite);
        gl_PointSize = max(1.0, (1.2 + 2.2 * tint) * uViewport / 900.0);
        gl_Position = projectionMatrix * mv;
        return;
    }

    float k = inOut(stagger(uCore, fract(seed * 3.7), 0.7));
    float w = stagger(uWorld, fract(seed * 5.3), 0.35);
    float we = outExpo(w);

    // the bloom: a few huge, faint sprites in the middle
    if (kind > 2.5) {
        float pulse = 0.85 + 0.15 * sin(t * 3.0 + seed * 6.0);
        float core = uCore * (1.0 - uWorld) * pulse;
        vAlpha = 0.16 * core + 0.6 * uIgnite + 0.05 * uWorld;
        vColor = mix(uColor, vec3(1.0), 0.35 + 0.4 * uIgnite);
        vSoft = 1.0;
        vec4 mv = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
        float size = mix(0.9, 2.6, seed) * (1.0 + 2.5 * uIgnite) * mix(1.0, 1.6, uWorld);
        gl_PointSize = min(size * projectionMatrix[1][1] * 0.5 * uViewport / -mv.z, uViewport * 1.2);
        gl_Position = projectionMatrix * mv;
        return;
    }

    bool isGit = kind < 0.5;

    // its cluster turns on itself
    vec3 offset = aOffset;
    offset.xz = rot(t * (0.25 + 0.5 * fract(seed * 13.1))) * offset.xz;
    vec3 clusterPos = aCenter + offset;

    // the repository: a lattice of git objects that turns slowly
    vec3 repo = position;
    repo.xz = rot(t * 0.22) * repo.xz;
    repo.yz = rot(0.38) * repo.yz;

    // 1 & 2. arrive: an arc from the source
    float arrive = isGit ? uStream : uPkg;
    float a = inOut(stagger(arrive, seed, isGit ? 1.8 : 1.3));
    vec3 target = isGit ? repo : clusterPos;
    vec3 ctrl = mix(aFrom, target, 0.55) + vec3((seed - 0.5) * 2.0, 1.4 + seed, 1.2);
    vec3 p = bezier(aFrom, ctrl, target, a);

    // 2. the git objects regroup as the app's own cluster
    float c = inOut(stagger(uPkg, fract(seed * 7.13), 0.8));
    if (isGit) p = mix(p, clusterPos, c);

    // 3. spiral into the core
    vec3 q = p;
    q.xz = rot(k * k * 5.0 * (0.6 + seed)) * q.xz;
    vec3 core = aCore * (1.0 + 0.08 * sin(t * 5.0 + seed * 20.0));
    p = mix(p, mix(q, core, k), k);

    // 4. ignite: burst out, overshoot, settle on the world
    vec3 normal;
    vec3 world = worldPosition(aWorld, t, normal);
    float burst = sin(w * PI) * (1.0 - 0.4 * w);
    world *= 1.0 + 0.9 * burst;
    p = mix(p, world, we);

    // idle drift
    float drift = (1.0 - uStill) * (0.01 + 0.02 * (1.0 - k) * (1.0 - we));
    p += drift * vec3(
        sin(t * 0.7 + seed * 40.0),
        cos(t * 0.6 + seed * 31.0),
        sin(t * 0.5 + seed * 17.0)
    );

    vec4 mv = modelViewMatrix * vec4(p, 1.0);

    // color: cool data, tinted packages, a white-hot core, the world's color
    vec3 data = vec3(0.72, 0.84, 1.0);
    vec3 pkgColor = aMeta.w < 0.001
        ? data
        : mix(uColor, palette(aMeta.w + 0.1), 0.45) * 1.15;
    vec3 col = isGit ? mix(data, pkgColor, c) : pkgColor;
    float heat = 1.0 - smoothstep(0.0, 0.26, length(aCore));
    vec3 hot = mix(uColor * 1.3, vec3(1.0, 0.97, 0.92), 0.35 + 0.6 * heat);
    col = mix(col, hot, k * (1.0 - we));

    // the world: brighter on its rim, like an atmosphere
    vec3 n = normalize((modelViewMatrix * vec4(normal, 0.0)).xyz);
    float rim = 1.0 - abs(dot(normalize(-mv.xyz), n));
    float isSphere = 1.0 - step(0.5, aWorld.w);
    vec3 worldCol = uColor * (0.55 + 0.6 * tint);
    worldCol = mix(worldCol, mix(uColor, vec3(1.0), 0.55), isSphere * rim * rim);
    // the ring: white-hot inside, drifting to a neighbouring hue outside
    float ringT = clamp((aWorld.x - 1.45) / 0.95, 0.0, 1.0);
    vec3 ringCol = mix(
        mix(uColor, vec3(1.0), 0.4),
        mix(uColor, palette(fract(0.55 + ringT * 0.35)), 0.55),
        ringT
    ) * (0.55 + 0.7 * tint);
    worldCol = mix(worldCol, ringCol, step(0.5, aWorld.w) * (1.0 - step(1.5, aWorld.w)));
    // the moons: bright sparks
    worldCol = mix(worldCol, mix(uColor, vec3(1.0), 0.7), step(1.5, aWorld.w));
    col = mix(col, worldCol, we);
    col = mix(col, vec3(1.0), uIgnite * 0.6);
    vColor = col;

    // hidden until it starts its journey; fades with distance and when it
    // flies past the camera
    float depth = -mv.z;
    float fog = clamp(1.25 - (depth - uCamDist) / (uCamDist * 1.4), 0.25, 1.0);
    float near = smoothstep(0.15, 0.6, depth);
    vAlpha = smoothstep(0.0, 0.06, a) * mix(0.75, 1.0, tint) * fog * near;
    vAlpha *= mix(1.0, 0.75 + 0.6 * rim, isSphere * we);

    float size = uSize * (0.6 + tint * 0.9) * (isGit ? 1.7 - 0.6 * c : 1.0);
    size *= mix(1.0, 0.8, k * (1.0 - we));
    size *= 1.0 + 0.5 * burst + uIgnite;
    gl_PointSize = clamp(size * projectionMatrix[1][1] * 0.5 * uViewport / depth, 1.5, uViewport * 0.06);
    gl_Position = projectionMatrix * mv;
}
`;

export const fragmentShader = /* glsl */ `
precision mediump float;
varying vec3 vColor;
varying float vAlpha;
varying float vSoft;

void main() {
    vec2 c = gl_PointCoord - 0.5;
    float d2 = dot(c, c) * 4.0; // 0 in the middle, 1 on the edge
    if (d2 > 1.0) discard;
    // a bright center and a faint halo; the bloom sprites are all halo
    float sharp = exp(-d2 * 14.0) + 0.28 * exp(-d2 * 3.5);
    float soft = exp(-d2 * 3.0) * (1.0 - d2);
    float alpha = mix(sharp, soft, vSoft) * vAlpha;
    gl_FragColor = vec4(vColor, alpha);
}
`;
