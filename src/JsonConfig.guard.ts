/*
 * Generated type guards for "JsonConfig.ts".
 * WARNING: Do not manually change this file.
 */
import { JSONConfig } from "./JsonConfig";
import Ajv from 'ajv';
import * as schema from './Schema/schema.json';

const ajv = new Ajv();

export function isJsonConfig(obj: any): obj is JSONConfig {
    const valid = ajv.validate(schema, obj);
    if(valid) {
        return true;
    } else {
        throw new Error('Invalid json schema')
    }
}
