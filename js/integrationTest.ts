import { httpRoute, createRouter, fromNow } from "./src";

const apiKey = process.env.API_KEY;
if (!apiKey) {
    throw new Error("API_KEY is required");
}

const publicKey = process.env.PUBLIC_KEY;
if (!publicKey) {
    throw new Error("PUBLIC_KEY is required");
}

const endpointId = process.env.ENDPOINT_ID;
if (!endpointId) {
    throw new Error("ENDPOINT_ID is required");
}

let thing: string | undefined;

async function endpoint(setThing: string) {
    console.log("Setting thing to", setThing);
    thing = setThing;
}

const router = createRouter(
    apiKey, "test123", publicKey, endpointId,
    {
        my: {
            awesome: {
                endpoint,
            },
        },
    },
);

const httpRouteRes = httpRoute(router);

Bun.serve({
    fetch: async (req) => {
        if (req.method === "POST") {
            console.log("Received POST request, headers:", req.headers);
            return httpRouteRes(req);
        }
        return new Response("Not found", { status: 404 });
    },
    port: 8080,
});

await router.my.awesome.endpoint(
    fromNow((c) => c.seconds(5)),
    "hello",
);

await Bun.sleep(7000);

if (thing !== "hello") {
    throw new Error("thing should be hello");
}

console.log("Looks good to me!");
