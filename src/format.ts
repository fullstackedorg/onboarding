export function formatBytes(bytes: number): string {
    if (!bytes || bytes < 1000) return `${bytes || 0} B`;
    if (bytes < 1e6) return `${Math.round(bytes / 1e3)} KB`;
    if (bytes < 1e9) return `${(bytes / 1e6).toFixed(1)} MB`;
    return `${(bytes / 1e9).toFixed(1)} GB`;
}

export function formatSeconds(seconds: number): string {
    return `${seconds.toFixed(1)} s`;
}

export function plural(count: number, one: string, many = `${one}s`) {
    return `${count} ${count === 1 ? one : many}`;
}

// esbuild and the CLI color their messages
export function stripAnsi(text: string): string {
    return text.replace(/\x1b\[[0-9;]*[A-Za-z]/g, "");
}
