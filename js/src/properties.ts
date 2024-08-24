export class DeltaBuilder {
    #years = 0;
    #months = 0;
    #days = 0;
    #hours = 0;
    #minutes = 0;
    #seconds = 0;

    years(years: number) {
        this.#years += years;
        return this;
    }

    months(months: number) {
        this.#months += months;
        return this;
    }

    days(days: number) {
        this.#days += days;
        return this;
    }

    hours(hours: number) {
        this.#hours += hours;
        return this;
    }

    minutes(minutes: number) {
        this.#minutes += minutes;
        return this;
    }

    seconds(seconds: number) {
        this.#seconds += seconds;
        return this;
    }

    toObject() {
        return {
            years: this.#years,
            months: this.#months,
            days: this.#days,
            hours: this.#hours,
            minutes: this.#minutes,
            seconds: this.#seconds,
        };
    }
}

type DeltaBody = ReturnType<DeltaBuilder["toObject"]>;

type StartFrom = ({ type: "delta" } & DeltaBody) | {
    type: "datetime";
    datetime: string;
}

export class CreateJobProperties {
    #customId: string | null = null;

    constructor(private startFrom: StartFrom, private runEvery: DeltaBody | null) {}

    customId(customId: string) {
        this.#customId = customId;
        return this;
    }

    toObject() {
        return {
            id: this.#customId,
            data: {
                start_from: this.startFrom,
                run_every: this.runEvery,
            },
        };
    }
}

export function fromDatetime(datetime: string | Date, runEvery?: (c: DeltaBuilder) => void) {
    let dtStr: string;
    if (datetime instanceof Date) {
        dtStr = datetime.toISOString();
    } else {
        dtStr = new Date(datetime).toISOString();
    }

    let runEveryBody: DeltaBody | null = null;
    if (runEvery) {
        const builder = new DeltaBuilder();
        runEvery(builder);
        runEveryBody = builder.toObject();
    }

    const startFrom = { type: "datetime" as const, datetime: dtStr };
    return new CreateJobProperties(startFrom, runEveryBody);
}

class DeltaBuilderWithRecurringFlag extends DeltaBuilder {
    constructor(private recurringCb: () => void) {
        super();
    }

    recurring() {
        this.recurringCb();
        return this;
    }
}

export function fromNow(delta?: (c: DeltaBuilderWithRecurringFlag) => void) {
    let recurring = false;
    const builder = new DeltaBuilderWithRecurringFlag(() => {
        recurring = true;
    });
    delta?.(builder);
    const deltaBody = builder.toObject();
    const startFrom = { type: "delta" as const, ...deltaBody };
    const runEvery = recurring ? deltaBody : null;
    return new CreateJobProperties(startFrom, runEvery);
}
