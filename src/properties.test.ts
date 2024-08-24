import { describe, test, expect } from "bun:test";
import { DeltaBuilder, fromDatetime, fromNow } from "./properties";

test("DeltaBuilder builds the delta properly", () => {
    const d = new DeltaBuilder();
    d.years(1).months(2).days(3).hours(4).minutes(5).seconds(6).years(1);
    expect(d.toObject()).toEqual({
        years: 2,
        months: 2,
        days: 3,
        hours: 4,
        minutes: 5,
        seconds: 6,
    });
});

describe("fromDatetime", () => {
    test("delta argument works", () => {
        const epochStart = new Date(0);
        let o = fromDatetime(epochStart).toObject();
        expect(o.data.run_every).toBe(null);
        o = fromDatetime(
            epochStart, (c) => {
                if (!(c instanceof DeltaBuilder)) {
                    throw new Error("Expected DeltaBuilder");
                }
                c.years(69).minutes(10);
            },
        ).toObject();
        expect(o.data.run_every).toEqual({
            years: 69,
            months: 0,
            days: 0,
            hours: 0,
            minutes: 10,
            seconds: 0,
        });
    });

    test("initialize with a bad date", () => {
        expect(() => fromDatetime("bad date")).toThrow();
    });

    test("initialize with a ISO date string", () => {
        const isoDate = "2021-01-01T00:00:00.000Z";
        const o = fromDatetime(isoDate).toObject();
        expect(o.data.start_from).toEqual({
            type: "datetime",
            datetime: isoDate,
        });
        expect(o.data.run_every).toBe(null);
    });
})

describe("fromNow", () => {
    test("customId is set properly", () => {
        const c = fromNow();
        expect(c.toObject().id).toBe(null);
        c.customId("test");
        expect(c.toObject().id).toBe("test");
    });

    test("inputting a non-recurring delta works", () => {
        const c = fromNow(
            (c) => c.years(1).months(2).days(3).hours(4).minutes(5).seconds(6),
        );
        const o = c.toObject();
        expect(o.data.start_from).toEqual({
            type: "delta",
            years: 1,
            months: 2,
            days: 3,
            hours: 4,
            minutes: 5,
            seconds: 6,
        });
        expect(o.data.run_every).toBe(null);
    });

    test("inputting a recurring delta works", () => {
        const c = fromNow(
            (c) => c.years(1).recurring(),
        );
        const o = c.toObject();
        expect(o.data.start_from).toEqual({
            type: "delta",
            years: 1,
            months: 0,
            days: 0,
            hours: 0,
            minutes: 0,
            seconds: 0,
        });
        expect(o.data.run_every).toEqual({
            years: 1,
            months: 0,
            days: 0,
            hours: 0,
            minutes: 0,
            seconds: 0,
        });
    });
});
