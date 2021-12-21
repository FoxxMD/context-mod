import {Request, Response} from 'express';

export interface defaultOptions {
    name: string,
    defaultVal: any
    required?: boolean
}

export type QueryTransformFunc = (name: string, val: any) => any

export const queryDataTransformer = (transform: QueryTransformFunc) => (params: (string | defaultOptions)[] = [], defaultRequired: boolean = false) => async (req: Request, res: Response, next: Function) => {
    for (const p of params) {
        const opts = typeof p === 'string' ? {
            name: p,
            defaultVal: undefined,
            required: defaultRequired
        } : p as defaultOptions;

        const {
            name,
            defaultVal,
            required = defaultRequired
        } = opts;

        const pVal = req.query[name] as any;
        if (pVal !== undefined) {
            try {
                req.query[name] = transform(name, pVal);
            } catch (err: any) {
                const {code = 400, message} = err;
                res.status(code);
                return res.send(message);
            }
        } else if (defaultVal !== undefined) {
            req.query[name] = defaultVal;
        } else if (required) {
            res.status(400);
            return res.send(`Expected query parameter ${name} to be set but it was missing`);
        }
    }
    next();
}

export const booleanMiddle = queryDataTransformer((name:string, val: any) => {
    let truthyVal: boolean;
    if (val === 'true' || val === true || val === 1 || val === '1') {
        truthyVal = true;
    } else if (val === 'false' || val === false || val === 0 || val === '0') {
        truthyVal = false;
    } else {
        throw new Error(`Expected query parameter ${name} to be a truthy value. Got "${val}" but must be one of these: true/false, 1/0`)
    }
    return truthyVal;
});

export const arrayMiddle = queryDataTransformer((name, val: any) => {
   if(Array.isArray(val)) {
       return val;
   }
   let strVal = val;
   if(typeof strVal === 'number') {
       strVal = val.toString();
   }
   return strVal.split(',').map((x: string) => x.trim());
});
