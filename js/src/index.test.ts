import { expect, test, describe } from "bun:test";
import * as c from "./index";
import { internalSym, poisonIv } from "./typed";
import { encode } from "@msgpack/msgpack";
import * as ed from "@noble/ed25519";

test("properties exports", () => {
    expect(c.CreateJobProperties).not.toBeUndefined();
    expect(c.fromDatetime).not.toBeUndefined();
    expect(c.fromNow).not.toBeUndefined();
});

const oldFetch = globalThis.fetch;
let activeFetchUsages = 0;

type FetchCall = [string | URL | Request, RequestInit | undefined];

async function patchFetchCalls<T>(
    response: Response, fn: () => Promise<T>, fetchCalls?: FetchCall[],
) {
    // Lock until fetch isn't used.
    while (activeFetchUsages++ !== 0) {
        activeFetchUsages--;
        await new Promise((resolve) => setTimeout(resolve, 2));
    }

    // Patch fetch and handle any calls to it.
    globalThis.fetch = async function (url, init) {
        fetchCalls?.push([url, init]);
        return response;
    };
    try {
        return await fn();
    } finally {
        globalThis.fetch = oldFetch;
        activeFetchUsages--;
    }
}

const id = "%%%&@";
const idEnc = encodeURIComponent(id);
const specificJobUrl = `https://clocktick.dev/api/v1/jobs/${idEnc}`;

describe("deleteJob", () => {
    test("errors if no job ID", async () => {
        expect(c.deleteJob("key", "")).rejects.toThrow("Invalid job ID.");
    });

    test("sends the correct payload with 204", async () => {
        const successResponse = new Response(null, { status: 204 });
        const fetchCalls: FetchCall[] = [];
        await patchFetchCalls(
            successResponse, () => c.deleteJob("key", id), fetchCalls,
        );

        expect(fetchCalls).toEqual([
            [specificJobUrl, {
                method: "DELETE",
                headers: {
                    Authorization: "Bearer key",
                },
            }],
        ]);
    });

    const wrapTest = (withHeader: boolean) => async () => {
        const headers: Record<string, string> = withHeader ? {
            "Content-Type": "application/json",
            "X-Is-Application-Error": "true",
        } : {
            "Content-Type": "application/json",
        };
        const errorResponse = new Response(JSON.stringify({
            type: "test",
            reasons: ["a", "b"],
        }), {
            status: 400,
            headers,
        });

        const fetchCalls: FetchCall[] = [];
        try {
            await patchFetchCalls(
                errorResponse, () => c.deleteJob("key", "id"), fetchCalls,
            );
        } catch (e) {
            // Check the error type.
            if (withHeader) {
                expect(e).toBeInstanceOf(c.APIError);
                if (e instanceof c.APIError) {
                    expect(e.type).toBe("test");
                    expect(e.reasons).toEqual(["a", "b"]);
                }
            } else {
                expect(e).toBeInstanceOf(Error);
                if (e instanceof Error) {
                    expect(e.message).toBe("HTTP error: 400");
                }
            }

            // Check the fetch calls.
            expect(fetchCalls).toEqual([
                [`https://clocktick.dev/api/v1/jobs/id`, {
                    method: "DELETE",
                    headers: {
                        Authorization: "Bearer key",
                    },
                }],
            ]);

            // Return now since there was an error as expected.
            return;
        }

        throw new Error("Expected an error.");
    };
    test("handle wrappable API errors with header", wrapTest(true));
    test("handle wrappable API errors without header", wrapTest(false));

    test("handle unwrappable API errors", async () => {
        const errorResponse = new Response("cat tripped oops", { status: 400 });

        const fetchCalls: FetchCall[] = [];
        try {
            await patchFetchCalls(
                errorResponse, () => c.deleteJob("key", "id"), fetchCalls,
            );
        } catch (e) {
            expect(e).toBeInstanceOf(Error);
            if (e instanceof Error) {
                expect(e.message).toBe("HTTP error: 400");
            }

            expect(fetchCalls).toEqual([
                [`https://clocktick.dev/api/v1/jobs/id`, {
                    method: "DELETE",
                    headers: {
                        Authorization: "Bearer key",
                    },
                }],
            ]);

            return;
        }

        throw new Error("Expected an error.");
    });
});

test("customEndpoint creates object with internal data", () => {
    // @ts-expect-error: The types are intentionally off. People using this
    // function in other contexts are misusing it.
    expect(c.customEndpoint("test", 1)).toEqual({
        fnOrFns: 1,
        [internalSym]: ["test", 1],
    });
});

const testIv = new Uint8Array([
    0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b, 0x0c,
]);
poisonIv(testIv);

const hashedEncryptionKey = crypto.subtle.digest("SHA-256", new TextEncoder().encode("encryption_key_here")).then((key) => {
    return crypto.subtle.importKey("raw", key, "AES-GCM", true, ["encrypt", "decrypt"]);
});

async function fakeEncrypt(data: any) {
    const encodedData = encode(data);
    const key = await hashedEncryptionKey;
    const encrypted = await crypto.subtle.encrypt(
        { name: "AES-GCM", iv: testIv }, key, encodedData,
    );

    // @ts-ignore: This ignore hopefully won't be needed soon, but it is a
    // very new feature.
    return `${testIv.toBase64()}:${new Uint8Array(encrypted).toBase64()}`;
}

const fetchReq = (url: string, body: any) => [url, {
    method: "POST",
    headers: {
        Authorization: "Bearer key",
        "Content-Type": "application/json",
    } as Record<string, string>,
    body: JSON.stringify(body),
} as RequestInit] as FetchCall;

const firstDate = new Date(0);

describe("createRouter", () => {
    test("single level function", async () => {
        const router = c.createRouter(
            "key", "encryption_key_here", "public_key_here", "default_endpoint_id",
            {
                test1: async (a: string) => a,
                test2: async (b: number) => b,
                test3: c.customEndpoint("test3_endpoint", async (c: boolean, d: string) => [c, d]),
            },
        );

        const fetchCalls: FetchCall[] = [];
        const fromWithCustomId = c.fromDatetime(firstDate).customId(id);
        const fromWithDefaultId = c.fromDatetime(firstDate);
        const e = async (res: Promise<{ id: string }>) =>
            expect(await res).toEqual({ id: "job_id" });
        const resp = () => new Response(JSON.stringify({ id: "job_id" }), {
            headers: {
                "Content-Type": "application/json",
            },
            status: 200,
        });
        await e(patchFetchCalls(
            resp(), () => router.test1(fromWithCustomId, "a"), fetchCalls,
        ));
        await e(patchFetchCalls(
            resp(), () => router.test1(fromWithDefaultId, "a"), fetchCalls,
        ));
        await e(patchFetchCalls(
            resp(), () => router.test2(fromWithDefaultId, 1), fetchCalls,
        ));
        await e(patchFetchCalls(
            resp(), () => router.test3(fromWithDefaultId, true, "d"), fetchCalls,
        ));
        await e(patchFetchCalls(
            resp(), () => router.test3(fromWithDefaultId, true, "d"), fetchCalls,
        ));

        const defaultUrl = "https://clocktick.dev/api/v1/jobs";
        expect(fetchCalls).toEqual([
            fetchReq(specificJobUrl, {
                start_from: {
                    type: "datetime",
                    datetime: firstDate.toISOString(),
                },
                run_every: null, // tested by properties.test.ts
                endpoint_id: "default_endpoint_id",
                encrypted_data: await fakeEncrypt(["a"]),
                job_type: "test1",
            }),
            fetchReq(defaultUrl, {
                start_from: {
                    type: "datetime",
                    datetime: firstDate.toISOString(),
                },
                run_every: null, // tested by properties.test.ts
                endpoint_id: "default_endpoint_id",
                encrypted_data: await fakeEncrypt(["a"]),
                job_type: "test1",
            }),
            fetchReq(defaultUrl, {
                start_from: {
                    type: "datetime",
                    datetime: firstDate.toISOString(),
                },
                run_every: null, // tested by properties.test.ts
                endpoint_id: "default_endpoint_id",
                encrypted_data: await fakeEncrypt([1]),
                job_type: "test2",
            }),
            fetchReq(defaultUrl, {
                start_from: {
                    type: "datetime",
                    datetime: firstDate.toISOString(),
                },
                run_every: null, // tested by properties.test.ts
                endpoint_id: "test3_endpoint",
                encrypted_data: await fakeEncrypt([true, "d"]),
                job_type: "test3",
            }),
            fetchReq(defaultUrl, {
                start_from: {
                    type: "datetime",
                    datetime: firstDate.toISOString(),
                },
                run_every: null, // tested by properties.test.ts
                endpoint_id: "test3_endpoint",
                encrypted_data: await fakeEncrypt([true, "d"]),
                job_type: "test3",
            }),
        ]);
    });

    test("multiple levels", async () => {
        const router = c.createRouter(
            "key", "encryption_key_here", "public_key_here", "default_endpoint_id",
            {
                test1: async (a: string) => a,
                test2: c.customEndpoint("test2_endpoint", {
                    test3: async (a: string) => a,
                    test4: c.customEndpoint("test4_endpoint", async (a: string) => a),
                }),
            },
        );

        const fetchCalls: FetchCall[] = [];
        const from = c.fromDatetime(firstDate);
        const e = async (res: Promise<{ id: string }>) =>
            expect(await res).toEqual({ id: "job_id" });
        const resp = () => new Response(JSON.stringify({ id: "job_id" }), {
            headers: {
                "Content-Type": "application/json",
            },
            status: 200,
        });
        await e(patchFetchCalls(
            resp(), () => router.test1(from, "a"), fetchCalls,
        ));
        await e(patchFetchCalls(
            resp(), () => router.test2.test3(from, "a"), fetchCalls,
        ));
        await e(patchFetchCalls(
            resp(), () => router.test2.test4(from, "a"), fetchCalls,
        ));

        const defaultUrl = "https://clocktick.dev/api/v1/jobs";
        expect(fetchCalls).toEqual([
            fetchReq(defaultUrl, {
                start_from: {
                    type: "datetime",
                    datetime: firstDate.toISOString(),
                },
                run_every: null, // tested by properties.test.ts
                endpoint_id: "default_endpoint_id",
                encrypted_data: await fakeEncrypt(["a"]),
                job_type: "test1",
            }),
            fetchReq(defaultUrl, {
                start_from: {
                    type: "datetime",
                    datetime: firstDate.toISOString(),
                },
                run_every: null, // tested by properties.test.ts
                endpoint_id: "test2_endpoint",
                encrypted_data: await fakeEncrypt(["a"]),
                job_type: "test2.test3",
            }),
            fetchReq(defaultUrl, {
                start_from: {
                    type: "datetime",
                    datetime: firstDate.toISOString(),
                },
                run_every: null, // tested by properties.test.ts
                endpoint_id: "test4_endpoint",
                encrypted_data: await fakeEncrypt(["a"]),
                job_type: "test2.test4",
            }),
        ]);
    });

    const wrapTest = (withHeader: boolean) => async () => {
        const headers: Record<string, string> = withHeader ? {
            "Content-Type": "application/json",
            "X-Is-Application-Error": "true",
        } : {
            "Content-Type": "application/json",
        };
        const errorResponse = new Response(JSON.stringify({
            type: "test",
            reasons: ["a", "b"],
        }), {
            status: 400,
            headers,
        });

        const router = c.createRouter(
            "key", "encryption_key_here", "public_key_here", "default_endpoint_id",
            {
                test1: async (a: string) => a,
            },
        );
        try {
            await patchFetchCalls(
                errorResponse, () => router.test1(c.fromDatetime(firstDate), "a"),
            );
        } catch (e) {
            // Check the error type.
            if (withHeader) {
                expect(e).toBeInstanceOf(c.APIError);
                if (e instanceof c.APIError) {
                    expect(e.type).toBe("test");
                    expect(e.reasons).toEqual(["a", "b"]);
                }
            } else {
                expect(e).toBeInstanceOf(Error);
                if (e instanceof Error) {
                    expect(e.message).toBe("HTTP error: 400");
                }
            }

            return;
        }

        throw new Error("Expected an error.");
    };
    test("handle wrappable API errors with header", wrapTest(true));
    test("handle wrappable API errors without header", wrapTest(false));

    test("handle unwrappable API errors", async () => {
        const errorResponse = new Response("cat tripped oops", { status: 400 });

        const router = c.createRouter(
            "key", "encryption_key_here", "public_key_here", "default_endpoint_id",
            {
                test1: async (a: string) => a,
            },
        );
        try {
            await patchFetchCalls(
                errorResponse, () => router.test1(c.fromDatetime(firstDate), "a"),
            );
        } catch (e) {
            expect(e).toBeInstanceOf(Error);
            if (e instanceof Error) {
                expect(e.message).toBe("HTTP error: 400");
            }

            return;
        }

        throw new Error("Expected an error.");
    });
});

test("httpRoute routes to correct functions", async () => {
    // Create a public/private key pair for signing.
    const privateKey = ed.utils.randomPrivateKey();
    const publicKey = Buffer.from(
        await ed.getPublicKeyAsync(privateKey),
    ).toString("hex");

    // Create a new signed JSON request.
    const newSignedJsonRequest = async (data: any) => {
        const encodedData = JSON.stringify(data);
        const timestamp = Math.round(Date.now() / 1000).toString();
        const toSign = Uint8Array.from(
            Buffer.concat([Buffer.from(timestamp), Buffer.from(encodedData)]),
        );
        const signature = await ed.signAsync(toSign, privateKey);
        return new Request("http://localhost", {
            method: "POST",
            headers: new Headers({
                "Content-Type": "application/json",
                "X-Signature-Ed25519": Buffer.from(signature).toString("hex"),
                "X-Signature-Timestamp": timestamp,
            }),
            body: encodedData,
        });
    };

    // Defines a router with a few routes.
    const routesHit: number[] = [];
    const router = c.createRouter(
        "key", "encryption_key_here", publicKey, "default_endpoint_id",
        {
            test1: async (n: number) => { routesHit.push(n); },
            test2: {
                test3: c.customEndpoint("test3_endpoint", {
                    test4: async (n: number) => { routesHit.push(n); },
                }),
            },
        },
    );

    // Build the HTTP route and call it.
    const route = c.httpRoute(router);
    const resp1 = await route(await newSignedJsonRequest({
        type: "test1",
        encrypted_data: await fakeEncrypt([1]),
    }));
    expect(resp1.status).toBe(204);
    const resp2 = await route(await newSignedJsonRequest({
        type: "test2.test3.test4",
        encrypted_data: await fakeEncrypt([2]),
    }));
    expect(resp2.status).toBe(204);

    // Handle if the encrypted data is broken.
    const badData = await newSignedJsonRequest({
        type: "test1",
        encrypted_data: "bad",
    });
    const badDataResp = await route(badData);
    expect(badDataResp.status).toBe(400);

    // Make sure that we deny requests with invalid signatures.
    const unsignedRequest = await newSignedJsonRequest({
        type: "test1",
        encrypted_data: await fakeEncrypt([1]),
    });
    unsignedRequest.headers.set("X-Signature-Ed25519", "bad");
    const badResp = await route(unsignedRequest);
    expect(badResp.status).toBe(401);

    // Handle if the endpoint is not found.
    const badEndpoint = await newSignedJsonRequest({
        type: "test69",
        encrypted_data: await fakeEncrypt([1]),
    });
    const badEndpointResp = await route(badEndpoint);
    expect(badEndpointResp.status).toBe(404);

    // Check that the routes were hit twice for both valid requests.
    expect(routesHit).toEqual([1, 2]);
});
