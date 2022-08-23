import YamlConfigDocument from "../YamlConfigDocument";
import JsonConfigDocument from "../JsonConfigDocument";
import {YAMLMap, YAMLSeq, Pair, Scalar} from "yaml";
import {BotInstanceJsonConfig, OperatorJsonConfig, WebCredentials} from "../../interfaces";
import {assign} from 'comment-json';

export interface OperatorConfigDocumentInterface {
    addBot(botData: BotInstanceJsonConfig): void;
    setFriendlyName(name: string): void;
    setWebCredentials(data: Required<WebCredentials>): void;
    setOperator(name: string): void;
    toJS(): OperatorJsonConfig;
}

export class YamlOperatorConfigDocument extends YamlConfigDocument implements OperatorConfigDocumentInterface {
    addBot(botData: BotInstanceJsonConfig) {
        const bots = this.parsed.get('bots') as YAMLSeq;
        if (bots === undefined) {
            this.parsed.add({key: 'bots', value: [botData]});
        } else if (botData.name !== undefined) {
            // granularly overwrite (merge) if we find an existing
            const existingIndex = bots.items.findIndex(x => (x as YAMLMap).get('name') === botData.name);
            if (existingIndex !== -1) {
                const botObj = this.parsed.getIn(['bots', existingIndex]) as YAMLMap;
                const mergedVal = mergeObjectToYaml(botData, botObj);
                this.parsed.setIn(['bots', existingIndex], mergedVal);
            } else {
                this.parsed.addIn(['bots'], botData);
            }
        } else {
            this.parsed.addIn(['bots'], botData);
        }
    }

    setFriendlyName(name: string) {
        this.parsed.addIn(['api', 'friendly'], name);
    }

    setWebCredentials(data: Required<WebCredentials>) {
        this.parsed.addIn(['web', 'credentials'], data);
    }

    setOperator(name: string) {
        this.parsed.addIn(['operator', 'name'], name);
    }

    toJS(): OperatorJsonConfig  {
        return super.toJS();
    }
}

export const mergeObjectToYaml = (source: object, target: YAMLMap) => {
    for (const [k, v] of Object.entries(source)) {
        if (target.has(k)) {
            const targetProp = target.get(k);
            if (targetProp instanceof YAMLMap && typeof v === 'object') {
                const merged = mergeObjectToYaml(v, targetProp);
                target.set(k, merged)
            } else {
                // since target prop and value are not both objects don't bother merging, just overwrite (primitive or array)
                target.set(k, v);
            }
        } else {
            target.add({key: k, value: v});
        }
    }
    return target;
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

    setFriendlyName(name: string) {
        const api = this.parsed.api || {};
        this.parsed.api = {...api, friendly: name};
    }

    setWebCredentials(data: Required<WebCredentials>) {
        const {
            web = {},
        } = this.parsed;

        this.parsed.web = {...web, credentials: data};
    }

    setOperator(name: string) {
        this.parsed.operator = { name };
    }

    toJS(): OperatorJsonConfig {
        return super.toJS();
    }
}
