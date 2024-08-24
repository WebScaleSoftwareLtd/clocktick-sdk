import { fromByteArray } from "base64-js";

export const internalSym = Symbol("_internal");
export let fixedIv: Uint8Array | null = null;

export function poisonIv(iv: Uint8Array | null) {
    fixedIv = iv;
}

export function findBestB64Strat(ignoreToBase64: boolean, ignoreNode: boolean) {
    if (!ignoreToBase64 && "toBase64" in Uint8Array.prototype) {
        // @ts-expect-error: The types are intentionally off. People using this
        // function in other contexts are misusing it.
        return (arr: Uint8Array) => arr.toBase64() as string;
    }

    const buffer = (() => "Buffer")();
    // @ts-expect-error: We are intentionally abusing JS here so that bundlers
    // don't include Buffer. We are smarter than them.
    const Buffer = globalThis[buffer] as typeof import("buffer").Buffer | undefined;
    if (!ignoreNode && Buffer) {
        // On Node.js, we can use Buffer.
        return (arr: Uint8Array) => Buffer.from(arr).toString("base64");
    }

    // Use base64-js.
    return (arr: Uint8Array) => fromByteArray(arr);
}

export const toBase64Polyfill = findBestB64Strat(false, false);

// Capture fetch in case it is overridden.
const mainFetch = globalThis.fetch;

export async function fromBase64(str: string) {
    const dataUrl = `data:application/octet-stream;base64,${str}`;
    return mainFetch(dataUrl)
        .then((res) => res.arrayBuffer())
        .then((buf) => new Uint8Array(buf));
}
