import {Request, Response} from 'express';

export const booleanMiddle = (boolParams: string[] = []) => async (req: Request, res: Response, next: Function) => {
    if (req.query !== undefined) {
        for (const b of boolParams) {
            const bVal = req.query[b] as any;
            if (bVal !== undefined) {
                let truthyVal: boolean;
                if (bVal === 'true' || bVal === true || bVal === 1 || bVal === '1') {
                    truthyVal = true;
                } else if (bVal === 'false' || bVal === false || bVal === 0 || bVal === '0') {
                    truthyVal = false;
                } else {
                    res.status(400);
                    res.send(`Expected query parameter ${b} to be a truthy value. Got "${bVal}" but must be one of these: true/false, 1/0`);
                    return;
                }
                // @ts-ignore
                req.query[b] = truthyVal;
            }
        }
    }
    next();
}
