import { ValueTransformer } from "typeorm"
import {Duration} from "dayjs/plugin/duration.js";
import {isNullOrUndefined} from "../../../util";
import dayjs from "dayjs";

/**
 * @see https://github.com/typeorm/typeorm/issues/873#issuecomment-424643086
 *
 * */
export class ColumnDurationTransformer implements ValueTransformer {
    to(data?: Duration): number | undefined {
        if (!isNullOrUndefined(data)) {
            return data.asSeconds();
        }
       return undefined;
    }

    from(data?: number | null): Duration | undefined {
        if (!isNullOrUndefined(data)) {
            return dayjs.duration(data, 'seconds')
        }
        return undefined
    }
}

export class ColumnDecimalTransformer implements ValueTransformer {
    to(data: number): number {
        return data;
    }
    from(data: string): number {
        return parseFloat(data);
    }
}
