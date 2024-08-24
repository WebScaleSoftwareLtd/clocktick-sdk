import { encode, decode } from "@msgpack/msgpack";
import { isValidRequest } from "discord-verify";
import {
    internalSym, fixedIv, toBase64Polyfill, fromBase64,
} from "./typed";

export { CreateJobProperties, fromDatetime, fromNow } from "./properties";

export class APIError extends Error {
    constructor(type, reasons) {
        super(`${type}: ${reasons.join(", ")}`);
        this.type = type;
        this.reasons = reasons;
    }
}

async function decrypt(key, data) {
    const [iv, encrypted] = data.split(":", 2);
    if (!iv || !encrypted) {
        throw new Error("Invalid encrypted data.");
    }
    const decrypted = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: await fromBase64(iv) }, key, await fromBase64(encrypted));
    return new Uint8Array(decrypted);
}

export function httpRoute(router) {
    const [fns, encryptionKey, publicKey] = router[internalSym];
    return async (req) => {
        // Verify the signature. We use discord-verify here because it is quite battle-tested and
        // we use the same verification method as the Discord API.
        const isValid = await isValidRequest(req, publicKey);
        if (!isValid) {
            return new Response("Unauthorized", { status: 401 });
        }

        // Decode the request body.
        const { type, encrypted_data } = await req.json();
        let data;
        try {
            data = decode(await decrypt(await encryptionKey, encrypted_data));
        } catch {
            return new Response("Bad Request", { status: 400 });
        }
        const fnParts = type.split(".");

        // Find the function to call.
        let fn = fns;
        for (const part of fnParts) {
            fn = fn[part];
            if (!fn) {
                return new Response("Endpoint Not Found", { status: 404 });
            }
            if (typeof fn === "object" && fn[internalSym]) {
                fn = fn.fnOrFns;
            }
        }
        if (typeof fn !== "function") {
            return new Response("Endpoint Not Found", { status: 404 });
        }

        // Call the function.
        await fn(...data);

        // Return a success response.
        return new Response(null, { status: 204 });
    };
}

async function errorHandledFetch(url, apiKey, method, body) {
    const headers = body ? {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
    } : {
        Authorization: `Bearer ${apiKey}`,
    };
    const res = await fetch(url, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
        // Check if X-Is-Application-Error is set to true.
        const isAppError = res.headers.get("X-Is-Application-Error");
        if (isAppError === "true") {
            // Decode the error.
            const error = await res.json();
            throw new APIError(error.type, error.reasons);
        } else {
            // Throw a generic error about the HTTP status code.
            throw new Error(`HTTP error: ${res.status}`);
        }
    }
    return res;
}

export async function deleteJob(apiKey, jobId) {
    if (typeof jobId !== "string" || jobId === "") {
        throw new Error("Invalid job ID.");
    }

    const url = `https://clocktick.io/api/v1/jobs/${encodeURIComponent(jobId)}`;
    await errorHandledFetch(url, apiKey, "DELETE");
}

async function encrypt(key, data) {
    const iv = fixedIv || crypto.getRandomValues(new Uint8Array(12));
    const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, data);
    return `${toBase64Polyfill(iv)}:${toBase64Polyfill(new Uint8Array(encrypted))}`;
}

function apiHandlerBuilder(apiKey, encryptionKey, jobType, endpoint) {
    return async (props, ...args) => {
        const key = await encryptionKey;
        const obj = props.toObject();
        let url = "https://clocktick.io/api/v1/jobs";
        if (obj.id !== null && obj.id !== "") {
            url += `/${encodeURIComponent(obj.id)}`;
        }
        const data = obj.data;
        data.endpoint_id = endpoint;
        data.encrypted_data = await encrypt(key, encode(args));
        data.job_type = jobType;
        return errorHandledFetch(url, apiKey, "POST", data).then((res) => res.json());
    };
}

export function customEndpoint(endpoint, fnOrFns) {
    return {
        fnOrFns,
        [internalSym]: [endpoint, fnOrFns],
    };
}

function _write(apiKey, encryptionKey, endpointId, obj, fns, keyStack) {
    for (const [key, value] of Object.entries(fns)) {
        if (typeof value === "function") {
            // Add a function to the object to call the endpoint.
            let k = keyStack.join(".");
            if (k === "") {
                k = key;
            } else {
                k += `.${key}`;
            }
            obj[key] = apiHandlerBuilder(apiKey, encryptionKey, k, endpointId);
        } else if (typeof value === "object" && value[internalSym]) {
            // Handle if we are a wrapped custom endpoint.
            const [customEndpointId, customFns] = value[internalSym];
            _write(apiKey, encryptionKey, customEndpointId, obj, { [key]: customFns }, keyStack);
        } else {
            // We are not. Recurse.
            const nextObj = {};
            keyStack.push(key);
            _write(apiKey, encryptionKey, endpointId, nextObj, value, keyStack);
            obj[key] = nextObj;
        }
    }

    // Pop the last key off the stack.
    keyStack.pop();
}

export function createRouter(apiKey, encryptionKey, publicKey, defaultEndpointId, fns) {
    // Hash the encryption key and load that as a raw key.
    encryptionKey = crypto.subtle.digest("SHA-256", new TextEncoder().encode(encryptionKey)).then((key) => {
        return crypto.subtle.importKey("raw", key, "AES-GCM", true, ["encrypt", "decrypt"]);
    });

    // Build the router handlers and return the object.
    const obj = {};
    _write(apiKey, encryptionKey, defaultEndpointId, obj, fns, []);
    obj[internalSym] = [fns, encryptionKey, publicKey];
    return obj;
}
