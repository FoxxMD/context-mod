import {ConfigFormat} from "../Infrastructure/Atomic";
import {Document as YamlDocument} from "yaml";
import {likelyJson5} from "../../util";
import JsonConfigDocument from "./JsonConfigDocument";
import YamlConfigDocument from "./YamlConfigDocument";
import {SimpleError} from "../../Utils/Errors";
import {ConfigDocumentInterface} from "./AbstractConfigDocument";
import {ConfigToObjectOptions} from "./ConfigToObjectOptions";

export const parseFromJsonOrYamlToObject = (content: string, options?: ConfigToObjectOptions): [ConfigFormat, ConfigDocumentInterface<YamlDocument | object>?, Error?, Error?] => {
    let obj;
    let configFormat: ConfigFormat = 'yaml';
    let jsonErr,
        yamlErr;

    const likelyType = likelyJson5(content) ? 'json' : 'yaml';

    const {
        location,
        jsonDocFunc = (content: string, location?: string) => new JsonConfigDocument(content, location),
        yamlDocFunc = (content: string, location?: string) => new YamlConfigDocument(content, location),
        allowArrays = false,
    } = options || {};

    try {
        const jsonObj = jsonDocFunc(content, location);
        const output = jsonObj.toJS();
        const oType = output === null ? 'null' : typeof output;
        if (oType !== 'object') {
            jsonErr = new SimpleError(`Parsing as json produced data of type '${oType}' (expected 'object')`);
            obj = undefined;
        } else {
            obj = jsonObj;
            configFormat = 'json';
        }
    } catch (err: any) {
        jsonErr = err;
    }

    try {
        const yamlObj = yamlDocFunc(content, location)
        const output = yamlObj.toJS();
        const oType = output === null ? 'null' : typeof output;
        if (oType !== 'object') {
            yamlErr = new SimpleError(`Parsing as yaml produced data of type '${oType}' (expected 'object')`);
            obj = undefined;
        } else if (obj === undefined && (likelyType !== 'json' || yamlObj.parsed.errors.length === 0)) {
            configFormat = 'yaml';
            if (yamlObj.parsed.errors.length !== 0) {
                yamlErr = new Error(yamlObj.parsed.errors.join('\n'))
            } else {
                obj = yamlObj;
            }
        }
    } catch (err: any) {
        yamlErr = err;
    }

    if (obj === undefined) {
        configFormat = likelyType;
    }
    return [configFormat, obj, jsonErr, yamlErr];
}
