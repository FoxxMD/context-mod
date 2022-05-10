import AbstractConfigDocument from "./AbstractConfigDocument";
import {Document, parseDocument} from 'yaml';
import {ConfigFormat} from "../Infrastructure/Atomic";

class YamlConfigDocument extends AbstractConfigDocument<Document> {

    public parsed: Document;
    public format: ConfigFormat;

    public constructor(raw: string, location?: string) {
        super(raw, location);
        this.parsed = parseDocument(raw);
        this.format = 'yaml';
    }
    public toJS(): object {
        return this.parsed.toJS();
    }

    public toString(): string {
        return this.parsed.toString();
    }
}

export default YamlConfigDocument;
