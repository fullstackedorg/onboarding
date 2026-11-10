import os from "os";

export type RuntimeInfo = {
    version: string; // "1.0.0"
    build: string; // "1861"
    platform: string; // os.platform() of the core: "darwin", "ios", "android", "win32", "linux"…
    arch: string;
};

export function runtimeInfo(): RuntimeInfo {
    const v = (process.versions as any)?.fullstacked ?? {};
    let platform = "unknown";
    let arch = "unknown";
    try {
        platform = os.platform();
        arch = os.arch();
    } catch {}
    return {
        version:
            v.major !== undefined
                ? `${v.major}.${v.minor}.${v.patch}`
                : "unknown",
        build: v.build !== undefined ? String(v.build) : "",
        platform,
        arch
    };
}

const platformNames: Record<string, string> = {
    darwin: "macOS",
    ios: "iOS",
    android: "Android",
    win32: "Windows",
    windows: "Windows",
    linux: "Linux"
};

export function platformName(platform: string) {
    return platformNames[platform] ?? platform;
}
