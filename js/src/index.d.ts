import type { CreateJobProperties } from "./properties";
import type { internalSym } from "./typed";
export { CreateJobProperties, fromDatetime, fromNow } from "./properties";

export class APIError extends Error {
    public readonly type: string;
    public readonly reasons: string[];
    constructor(type: string, reasons: string[]);
}

type TransformFunction<T> = T extends (...args: infer A) => any ?
    (props: CreateJobProperties, ...args: A) => Promise<{ id: string }> : never;

type ObjOrFn = { [key: string]: Function | ObjOrFn };

type PatchedRoutes<T> = {
    [K in keyof T]: T[K] extends Function ? TransformFunction<T[K]> :
    T[K] extends ObjOrFn ? PatchedRoutes<T[K]> : never;
} & { [internalSym]: any };

export function httpRoute<T extends ObjOrFn>(router: PatchedRoutes<T>):
    (req: Request) => Promise<Response>;
export function deleteJob(apiKey: string, jobId: string): Promise<void>;
export function customEndpoint<T>(endpoint: string, fnOrFns: T): T;
export function createRouter<Routes extends ObjOrFn>(
    apiKey: string, encryptionKey: string, publicKey: string,
    defaultEndpointId: string, fns: Routes,
): PatchedRoutes<Routes>;
