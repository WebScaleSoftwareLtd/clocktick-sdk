# Clocktick JS/TS SDK

The SDK used to integrate Clocktick into your JS/TS server-side code with strong typing. Compatible with Bun, Node, and the edge.

## Building the Router

To fire and consume jobs, you will want to create a router with the API key, encryption key, public key, default endpoint ID, and the routes. A "route" is an async function that can be nested in a object to create a tree of routes. Each route will be ran asynchronously and can take any number of parameters.

```ts
import { createRouter, customEndpoint } from "clocktick";

async function route(a: number, b: number) {
    // The function that will be called when the job triggers.
    console.log(a + b);
}

export default createRouter(
    process.env.CLOCKTICK_API_KEY,
    process.env.CLOCKTICK_ENCRYPTION_KEY,
    process.env.CLOCKTICK_PUBLIC_KEY,
    process.env.CLOCKTICK_DEFAULT_ENDPOINT_ID,
    {
        my: {
            nested: {
                route,
            },

            // We can also change the endpoint in the router (if say for example we have some endpoints that require Node).
            otherNested: customEndpoint(
                process.env.CLOCKTICK_OTHER_ENDPOINT_ID,
                {
                    route,
                },
            ),
        },
    },
);
```

From here, we should mount the endpoints. For example, if we set `https://<endpoint>/api/clocktick` as the endpoint in the Clocktick dashboard, we can use the following code to mount the router in Next app router (at `app/api/clocktick/route.ts`):

```ts
import { httpRoute } from "clocktick";
import router from "@/jobs";

export const POST = httpRoute(router);
```

You may want to duplicate this file if you have multiple routes (for example, one with the edge runtime and one with the Node runtime).

## Scheduling a Job

Once the endpoints are mounted, we can call the function in the router. The functions arguments are modified to take properties first and then the rest of the functions arguments. There are 2 functions we can use to build the job properties:

### Delta Builder

The delta builder has the following time units:

- `years(years: number)`: Adds the given number of years to the delta.
- `months(months: number)`: Adds the given number of months to the delta.
- `days(days: number)`: Adds the given number of days to the delta.
- `hours(hours: number)`: Adds the given number of hours to the delta.
- `minutes(minutes: number)`: Adds the given number of minutes to the delta.
- `seconds(seconds: number)`: Adds the given number of seconds to the delta.

Additionally, the delta builder supports setting a custom ID for the job with `customId(id: string)`. This is useful if you want to have a specific ID for the job. Note that this must be unique. If it is unset, a UUID will be generated.

### `fromNow`

This function tells the API to create a job starting from now and with a delta. This takes a optional function argument that takes a delta builder as an argument (with an additional `recurring` function attached to the builder which is used to say "run this job after this delta every delta"). If the function is not provided, it will be a run-time job that runs immediately.

### `fromDatetime`

This function tells the API to create a job starting from a specific date and time. This takes 2 arguments. The first argument is a string which is the date and time in ISO format or a `Date` object. The second argument is a function that takes a delta builder as an argument if you wish to have it recurring.

### Examples

If we wanted to run `my.nested.route` in 5 minutes, we could use the following code:

```ts
import { fromNow } from "clocktick";
import router from "@/jobs";

const { id } = await router.my.nested.route(
    fromNow((delta) => delta.minutes(5)),
    1, 2, // The arguments for the route. This is type checked!
);
```

If we wanted to run it every 5 minutes after 5 minutes time, we could use the following code:

```ts
const { id } = await router.my.nested.route(
    fromNow((delta) => delta.minutes(5).recurring()),
    1, 2,
);
```

If we wanted to run it at a specific time, we could use the following code:

```ts
const { id } = await router.my.nested.route(
    fromDatetime("2025-01-01T00:00:00Z"),
    1, 2,
);
```

And if we wanted to repeat it everyday after that time, we could use the following code:

```ts
const { id } = await router.my.nested.route(
    fromDatetime("2025-01-01T00:00:00Z", (delta) => delta.days(1)),
    1, 2,
);
```

## Deleting a Job

To delete a job, you can use the function `deleteJob(apiKey: string, jobId: string)` which returns a `Promise<void>`. This function will delete the job with the given `jobId` from Clocktick and presuming it isn't mid-fire will prevent it from firing.

## Development

To develop Clocktick's SDK, we use Bun. You will want a fairly recent version of Bun installed if you wish to not hit the slightly slower polyfills.

To ensure quality and consistency, the SDK is heavily unit tested with tests written in TypeScript to detect type discrepancies. To run the test suite, you can use `bun test` or just let the CI do it for you. Please add test cases for any additions you make!
