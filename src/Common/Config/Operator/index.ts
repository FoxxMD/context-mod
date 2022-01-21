import YamlConfigDocument from "../YamlConfigDocument";
import JsonConfigDocument from "../JsonConfigDocument";
import {YAMLMap, YAMLSeq} from "yaml";
import {BotInstanceJsonConfig, OperatorJsonConfig} from "../../interfaces";
import {assign} from 'comment-json';

export interface OperatorConfigDocumentInterface {
    addBot(botData: BotInstanceJsonConfig): void;
    toJS(): OperatorJsonConfig;
}

export class YamlOperatorConfigDocument extends YamlConfigDocument implements OperatorConfigDocumentInterface {
    addBot(botData: BotInstanceJsonConfig) {
        const bots = this.parsed.get('bots') as YAMLSeq;
        if (bots === undefined) {
            this.parsed.add({key: 'bots', value: [botData]});
        } else if (botData.name !== undefined) {
            // overwrite if we find an existing
            const existingIndex = bots.items.findIndex(x => (x as YAMLMap).get('name') === botData.name);
            if (existingIndex !== -1) {
                this.parsed.setIn(['bots', existingIndex], botData);
            } else {
                this.parsed.addIn(['bots'], botData);
            }
        } else {
            this.parsed.addIn(['bots'], botData);
        }
    }

    toJS(): OperatorJsonConfig  {
        return super.toJS();
    }
}

export class JsonOperatorConfigDocument extends JsonConfigDocument implements OperatorConfigDocumentInterface {
    addBot(botData: BotInstanceJsonConfig) {
        if (this.parsed.bots === undefined) {
            this.parsed.bots = [botData];
        } else if (botData.name !== undefined) {
            const existingIndex = this.parsed.bots.findIndex(x => x.name === botData.name);
            if (existingIndex !== -1) {
                this.parsed.bots[existingIndex] = assign(this.parsed.bots[existingIndex], botData);
            } else {
                this.parsed.bots.push(botData);
            }
        } else {
            this.parsed.bots.push(botData);
        }
    }

    toJS(): OperatorJsonConfig {
        return super.toJS();
    }
}
