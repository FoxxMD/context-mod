import AbstractConfigDocument from "./AbstractConfigDocument";
import {stringify, parse} from 'comment-json';
import JSON5 from 'json5';
import {ConfigFormat} from "../types";
import {OperatorJsonConfig} from "../interfaces";

class JsonConfigDocument extends AbstractConfigDocument<OperatorJsonConfig> {

    public parsed: OperatorJsonConfig;
    protected cleanParsed: OperatorJsonConfig;
    public format: ConfigFormat;

    public constructor(raw: string, location?: string) {
        super(raw, location);
        this.parsed = parse(raw);
        this.cleanParsed = JSON5.parse(raw);
        this.format = 'json';
    }

    public toJS(): OperatorJsonConfig {
        return this.cleanParsed;
    }

    public toString(): string {
        return stringify(this.parsed, null, 1);
    }

}

export default JsonConfigDocument;
