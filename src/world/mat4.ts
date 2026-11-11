// The little matrix math the world needs: a perspective camera with a view
// offset, looking at the origin, and a turn around the vertical axis.
// Column-major, like WebGL.

export type Mat4 = Float32Array;
export type Vec3 = [number, number, number];

export function perspective(
    fovDeg: number,
    aspect: number,
    near: number,
    far: number,
    // shifts the frame up or down, in pixels of a viewport `height` high
    // (THREE.PerspectiveCamera.setViewOffset with a vertical offset only)
    offsetY = 0,
    height = 1
): Mat4 {
    const top0 = near * Math.tan((fovDeg * Math.PI) / 360);
    const h = 2 * top0;
    const w = aspect * h;
    const left = -0.5 * w;
    const top = top0 - (offsetY * h) / height;
    const right = left + w;
    const bottom = top - h;
    const m = new Float32Array(16);
    m[0] = (2 * near) / (right - left);
    m[5] = (2 * near) / (top - bottom);
    m[8] = (right + left) / (right - left);
    m[9] = (top + bottom) / (top - bottom);
    m[10] = -(far + near) / (far - near);
    m[11] = -1;
    m[14] = (-2 * far * near) / (far - near);
    return m;
}

export function lookAtOrigin(eye: Vec3): Mat4 {
    const [ex, ey, ez] = eye;
    let zx = ex,
        zy = ey,
        zz = ez;
    let len = Math.hypot(zx, zy, zz) || 1;
    zx /= len;
    zy /= len;
    zz /= len;
    // x = up × z
    let xx = zz,
        xy = 0,
        xz = -zx;
    len = Math.hypot(xx, xy, xz) || 1;
    xx /= len;
    xy /= len;
    xz /= len;
    // y = z × x
    const yx = zy * xz - zz * xy;
    const yy = zz * xx - zx * xz;
    const yz = zx * xy - zy * xx;
    const m = new Float32Array(16);
    m[0] = xx;
    m[1] = yx;
    m[2] = zx;
    m[4] = xy;
    m[5] = yy;
    m[6] = zy;
    m[8] = xz;
    m[9] = yz;
    m[10] = zz;
    m[12] = -(xx * ex + xy * ey + xz * ez);
    m[13] = -(yx * ex + yy * ey + yz * ez);
    m[14] = -(zx * ex + zy * ey + zz * ez);
    m[15] = 1;
    return m;
}

export function multiply(a: Mat4, b: Mat4): Mat4 {
    const m = new Float32Array(16);
    for (let col = 0; col < 4; col++)
        for (let row = 0; row < 4; row++) {
            let sum = 0;
            for (let k = 0; k < 4; k++) sum += a[k * 4 + row] * b[col * 4 + k];
            m[col * 4 + row] = sum;
        }
    return m;
}

// a point through a matrix, with the perspective divide: clip → NDC
export function project(m: Mat4, p: Vec3): Vec3 {
    const [x, y, z] = p;
    const w = m[3] * x + m[7] * y + m[11] * z + m[15] || 1;
    return [
        (m[0] * x + m[4] * y + m[8] * z + m[12]) / w,
        (m[1] * x + m[5] * y + m[9] * z + m[13]) / w,
        (m[2] * x + m[6] * y + m[10] * z + m[14]) / w
    ];
}
