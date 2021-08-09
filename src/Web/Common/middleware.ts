import {Request, Response} from 'express';

export interface boolOptions {
    name: string,
    defaultVal: any
}

export const booleanMiddle = (boolParams: (string | boolOptions)[] = []) => async (req: Request, res: Response, next: Function) => {
    for (const b of boolParams) {
        const opts = typeof b === 'string' ? {name: b, defaultVal: undefined} : b as boolOptions;

        const bVal = req.query[opts.name] as any;
        if (bVal !== undefined) {
            let truthyVal: boolean;
            if (bVal === 'true' || bVal === true || bVal === 1 || bVal === '1') {
                truthyVal = true;
            } else if (bVal === 'false' || bVal === false || bVal === 0 || bVal === '0') {
                truthyVal = false;
            } else {
                res.status(400);
                return res.send(`Expected query parameter ${opts.name} to be a truthy value. Got "${bVal}" but must be one of these: true/false, 1/0`);
            }
            // @ts-ignore
            req.query[opts.name] = truthyVal;
        } else if (opts.defaultVal !== undefined) {
            req.query[opts.name] = opts.defaultVal;
        } else {
            res.status(400);
            return res.send(`Expected query parameter ${opts.name} to be a truthy value but it was missing. Must be one of these: true/false, 1/0`);
        }
    }
    next();
}
