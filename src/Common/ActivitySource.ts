import {ActivitySourceData, ActivitySourceTypes} from "./Infrastructure/Atomic";
import {strToActivitySourceData} from "../util";

export class ActivitySource {
    type: ActivitySourceTypes
    identifier?: string

    constructor(data: string | ActivitySourceData) {
        if (typeof data === 'string') {
            const {type, identifier} = strToActivitySourceData(data);
            this.type = type;
            this.identifier = identifier;
        } else {
            this.type = data.type;
            this.identifier = data.identifier;
        }
    }

    matches(desired: ActivitySource): boolean {
        if(desired.type !== this.type) {
            return false;
        }
        // if this source does not have an identifier (we have already matched type) then it is broad enough to match
        if(this.identifier === undefined) {
            return true;
        }
        // at this point we know this source has an identifier but desired DOES NOT so this source is more restrictive and does not match
        if(desired.identifier === undefined) {
            return false;
        }
        // otherwise sources match if identifiers are the same
        return this.identifier.toLowerCase() === desired.identifier.toLowerCase();
    }
}
