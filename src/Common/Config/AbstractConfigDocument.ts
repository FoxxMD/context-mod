import {ConfigFormat} from "../types";

export interface ConfigDocumentInterface<DocumentType> {
    format: ConfigFormat;
    parsed: DocumentType
    //parsingError: Error | string;
    raw: string;
    location?: string;
    toString(): string;
    toJS(): object;
}

abstract class AbstractConfigDocument<DocumentType> implements ConfigDocumentInterface<DocumentType> {
    public abstract format: ConfigFormat;
    public abstract parsed: DocumentType;
    //public abstract parsingError: Error | string;


    constructor(public raw: string, public location?: string) {
    }


    public abstract toString(): string;
    public abstract toJS(): object;
}

export default AbstractConfigDocument;
