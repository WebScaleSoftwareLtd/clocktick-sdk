import { describe, test, expect } from "bun:test";
import { toBase64Polyfill, findBestB64Strat } from "./typed";

describe("toBase64Polyfill", () => {
    test("toBase64 is used if available", () => {
        if (!("toBase64" in Uint8Array.prototype)) {
            console.log("toBase64 is not available");
            return;
        }
        let called = 0;
        const p = new Proxy(new Uint8Array([1, 2, 3]), {
            get(target, prop) {
                if (prop === "toBase64") {
                    called++;
                    return () => "PROXY_RESULT";
                }
                return Reflect.get(target, prop);
            },
        });
        const res = toBase64Polyfill(p);
        expect(res).toBe("PROXY_RESULT");
        expect(called).toBe(1);
    });

    test("Buffer is used if available", () => {
        const toBase64 = findBestB64Strat(true, false);
        if (toBase64 === toBase64Polyfill) {
            throw new Error("selector is broken");
        }
        const buf = new Uint8Array([1, 2, 3]);
        expect(toBase64(buf)).toBe("AQID");
    });

    test("base64-js is used if nothing else is available", () => {
        const toBase64 = findBestB64Strat(true, true);
        if (toBase64 === toBase64Polyfill) {
            throw new Error("selector is broken");
        }
        const buf = new Uint8Array([1, 2, 3]);
        expect(toBase64(buf)).toBe("AQID");
    });
});
