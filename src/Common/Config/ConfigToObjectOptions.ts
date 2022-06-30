import AbstractConfigDocument from "./AbstractConfigDocument";
import {OperatorJsonConfig} from "../interfaces";
import {Document as YamlDocument} from "yaml";

export interface ConfigToObjectOptions {
    location?: string,
    jsonDocFunc?: (content: string, location?: string) => AbstractConfigDocument<OperatorJsonConfig>,
    yamlDocFunc?: (content: string, location?: string) => AbstractConfigDocument<YamlDocument>
    allowArrays?: boolean
}
