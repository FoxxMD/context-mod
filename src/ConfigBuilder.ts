import {Logger} from "winston";
import {
    buildCacheOptionsFromProvider,
    createAjvFactory,
    mergeArr,
    normalizeName,
    overwriteMerge,
    parseBool, randomId,
    readJson,
    removeUndefinedKeys
} from "./util";
import {CommentCheck} from "./Check/CommentCheck";
import {SubmissionCheck} from "./Check/SubmissionCheck";

import Ajv, {Schema} from 'ajv';
import * as appSchema from './Schema/App.json';
import * as operatorSchema from './Schema/OperatorConfig.json';
import {JSONConfig} from "./JsonConfig";
import LoggedError from "./Utils/LoggedError";
import {CheckStructuredJson} from "./Check";
import {
    DEFAULT_POLLING_INTERVAL,
    DEFAULT_POLLING_LIMIT,
    OperatorJsonConfig,
    OperatorConfig,
    PollingOptions,
    PollingOptionsStrong,
    PollOn, StrongCache, CacheProvider, CacheOptions
} from "./Common/interfaces";
import {isRuleSetJSON, RuleSetJson, RuleSetObjectJson} from "./Rule/RuleSet";
import deepEqual from "fast-deep-equal";
import {ActionJson, ActionObjectJson, RuleJson, RuleObjectJson} from "./Common/types";
import {isActionJson} from "./Action";
import {getLogger} from "./Utils/loggerFactory";
import {GetEnvVars} from 'env-cmd';
import {operatorConfig} from "./Utils/CommandConfig";
import merge from 'deepmerge';
import * as process from "process";
import {cacheOptDefaults, cacheTTLDefaults} from "./Common/defaults";

export interface ConfigBuilderOptions {
    logger: Logger,
}

export const validateJson = (config: object, schema: Schema, logger: Logger): any => {
    const ajv = createAjvFactory(logger);
    const valid = ajv.validate(schema, config);
    if (valid) {
        return config;
    } else {
        logger.error('Json config was not valid. Please use schema to check validity.', {leaf: 'Config'});
        if (Array.isArray(ajv.errors)) {
            for (const err of ajv.errors) {
                let parts = [
                    `At: ${err.dataPath}`,
                ];
                let data;
                if (typeof err.data === 'string') {
                    data = err.data;
                } else if (err.data !== null && typeof err.data === 'object' && (err.data as any).name !== undefined) {
                    data = `Object named '${(err.data as any).name}'`;
                }
                if (data !== undefined) {
                    parts.push(`Data: ${data}`);
                }
                let suffix = '';
                // @ts-ignore
                if (err.params.allowedValues !== undefined) {
                    // @ts-ignore
                    suffix = err.params.allowedValues.join(', ');
                    suffix = ` [${suffix}]`;
                }
                parts.push(`${err.keyword}: ${err.schemaPath} => ${err.message}${suffix}`);

                // if we have a reference in the description parse it out so we can log it here for context
                if (err.parentSchema !== undefined && err.parentSchema.description !== undefined) {
                    const desc = err.parentSchema.description as string;
                    const seeIndex = desc.indexOf('[See]');
                    if (seeIndex !== -1) {
                        let newLineIndex: number | undefined = desc.indexOf('\n', seeIndex);
                        if (newLineIndex === -1) {
                            newLineIndex = undefined;
                        }
                        const seeFragment = desc.slice(seeIndex + 5, newLineIndex);
                        parts.push(`See:${seeFragment}`);
                    }
                }

                logger.error(`Schema Error:\r\n${parts.join('\r\n')}`, {leaf: 'Config'});
            }
        }
        throw new LoggedError('Config schema validity failure');
    }
}

export class ConfigBuilder {
    configLogger: Logger;
    logger: Logger;

    constructor(options: ConfigBuilderOptions) {

        this.configLogger = options.logger.child({leaf: 'Config'}, mergeArr);
        this.logger = options.logger;
    }

    validateJson(config: object): JSONConfig {
        const validConfig = validateJson(config, appSchema, this.logger);
        return validConfig as JSONConfig;
    }

    parseToStructured(config: JSONConfig): CheckStructuredJson[] {
        let namedRules: Map<string, RuleObjectJson> = new Map();
        let namedActions: Map<string, ActionObjectJson> = new Map();
        const {checks = []} = config;
        for (const c of checks) {
            const {rules = []} = c;
            namedRules = extractNamedRules(rules, namedRules);
            namedActions = extractNamedActions(c.actions, namedActions);
        }

        const structuredChecks: CheckStructuredJson[] = [];
        for (const c of checks) {
            const {rules = []} = c;
            const strongRules = insertNamedRules(rules, namedRules);
            const strongActions = insertNamedActions(c.actions, namedActions);
            const strongCheck = {...c, rules: strongRules, actions: strongActions} as CheckStructuredJson;
            structuredChecks.push(strongCheck);
        }

        return structuredChecks;
    }
}

export const buildPollingOptions = (values: (string | PollingOptions)[]): PollingOptionsStrong[] => {
    let opts: PollingOptionsStrong[] = [];
    for (const v of values) {
        if (typeof v === 'string') {
            opts.push({pollOn: v as PollOn, interval: DEFAULT_POLLING_INTERVAL, limit: DEFAULT_POLLING_LIMIT});
        } else {
            const {
                pollOn: p,
                interval = DEFAULT_POLLING_INTERVAL,
                limit = DEFAULT_POLLING_LIMIT,
                delayUntil,
            } = v;
            opts.push({pollOn: p as PollOn, interval, limit, delayUntil});
        }
    }
    return opts;
}

export const extractNamedRules = (rules: Array<RuleSetJson | RuleJson>, namedRules: Map<string, RuleObjectJson> = new Map()): Map<string, RuleObjectJson> => {
    //const namedRules = new Map();
    for (const r of rules) {
        let rulesToAdd: RuleObjectJson[] = [];
        if ((typeof r === 'object')) {
            if ((r as RuleObjectJson).kind !== undefined) {
                // itsa rule
                const rule = r as RuleObjectJson;
                if (rule.name !== undefined) {
                    rulesToAdd.push(rule);
                }
            } else {
                const ruleSet = r as RuleSetJson;
                const nestedNamed = extractNamedRules(ruleSet.rules);
                rulesToAdd = [...nestedNamed.values()];
            }
            for (const rule of rulesToAdd) {
                const name = rule.name as string;
                const normalName = normalizeName(name);
                const {name: n, ...rest} = rule;
                const ruleNoName = {...rest};

                if (namedRules.has(normalName)) {
                    const {name: nn, ...ruleRest} = namedRules.get(normalName) as RuleObjectJson;
                    if (!deepEqual(ruleRest, ruleNoName)) {
                        throw new Error(`Rule names must be unique (case-insensitive). Conflicting name: ${name}`);
                    }
                } else {
                    namedRules.set(normalName, rule);
                }
            }
        }
    }
    return namedRules;
}

export const insertNamedRules = (rules: Array<RuleSetJson | RuleJson>, namedRules: Map<string, RuleObjectJson> = new Map()): Array<RuleSetObjectJson | RuleObjectJson> => {
    const strongRules: Array<RuleSetObjectJson | RuleObjectJson> = [];
    for (const r of rules) {
        if (typeof r === 'string') {
            const foundRule = namedRules.get(r.toLowerCase());
            if (foundRule === undefined) {
                throw new Error(`No named Rule with the name ${r} was found`);
            }
            strongRules.push(foundRule);
        } else if (isRuleSetJSON(r)) {
            const {rules: sr, ...rest} = r;
            const setRules = insertNamedRules(sr, namedRules);
            const strongSet = {rules: setRules, ...rest} as RuleSetObjectJson;
            strongRules.push(strongSet);
        } else {
            strongRules.push(r);
        }
    }

    return strongRules;
}

export const extractNamedActions = (actions: Array<ActionJson>, namedActions: Map<string, ActionObjectJson> = new Map()): Map<string, ActionObjectJson> => {
    for (const a of actions) {
        if (!(typeof a === 'string')) {
            if (isActionJson(a) && a.name !== undefined) {
                const normalName = a.name.toLowerCase();
                const {name: n, ...rest} = a;
                const actionNoName = {...rest};
                if (namedActions.has(normalName)) {
                    // @ts-ignore
                    const {name: nn, ...aRest} = namedActions.get(normalName) as ActionObjectJson;
                    if (!deepEqual(aRest, actionNoName)) {
                        throw new Error(`Actions names must be unique (case-insensitive). Conflicting name: ${a.name}`);
                    }
                } else {
                    namedActions.set(normalName, a);
                }
            }
        }
    }
    return namedActions;
}

export const insertNamedActions = (actions: Array<ActionJson>, namedActions: Map<string, ActionObjectJson> = new Map()): Array<ActionObjectJson> => {
    const strongActions: Array<ActionObjectJson> = [];
    for (const a of actions) {
        if (typeof a === 'string') {
            const foundAction = namedActions.get(a.toLowerCase());
            if (foundAction === undefined) {
                throw new Error(`No named Action with the name ${a} was found`);
            }
            strongActions.push(foundAction);
        } else {
            strongActions.push(a);
        }
    }

    return strongActions;
}

export const parseOpConfigFromArgs = (args: any): OperatorJsonConfig => {
    const {
        subreddits,
        clientId,
        clientSecret,
        accessToken,
        refreshToken,
        redirectUri,
        wikiConfig,
        dryRun,
        heartbeat,
        softLimit,
        hardLimit,
        authorTTL,
        operator,
        operatorDisplay,
        snooProxy,
        snooDebug,
        sharedMod,
        logLevel,
        logDir,
        port,
        sessionSecret,
        caching,
        web
    } = args || {};

    const data = {
        operator: {
            name: operator,
            display: operatorDisplay
        },
        credentials: {
            clientId,
            clientSecret,
            accessToken,
            refreshToken,
            redirectUri,
        },
        subreddits: {
            names: subreddits,
            wikiConfig,
            heartbeatInterval: heartbeat,
            dryRun
        },
        logging: {
            level: logLevel,
            path: logDir === true ? `${process.cwd()}/logs` : undefined,
        },
        snoowrap: {
            proxy: snooProxy,
            debug: snooDebug,
        },
        web: {
            enabled: web,
            port,
            session: {
                secret: sessionSecret
            }
        },
        polling: {
            sharedMod,
        },
        caching: {
            provider: caching,
            authorTTL
        },
        nanny: {
            softLimit,
            hardLimit
        }
    }

    return removeUndefinedKeys(data) as OperatorJsonConfig;
}

const parseListFromEnv = (val: string|undefined) => {
    let listVals: undefined | string[];
    if(val === undefined) {
        return listVals;
    }
    const trimmedVal = val.trim();
    if (trimmedVal.includes(',')) {
        // try to parse using comma
        listVals = trimmedVal.split(',').map(x => x.trim()).filter(x => x !== '');
    } else {
        // otherwise try spaces
        listVals = trimmedVal.split(' ')
            // remove any extraneous spaces
            .filter(x => x !== ' ' && x !== '');
    }
    if (listVals.length === 0) {
        return undefined;
    }
    return listVals;
}

export const parseOpConfigFromEnv = (): OperatorJsonConfig => {
    const data = {
        operator: {
            name: parseListFromEnv(process.env.OPERATOR),
            display: process.env.OPERATOR_DISPLAY
        },
        credentials: {
            clientId: process.env.CLIENT_ID,
            clientSecret: process.env.CLIENT_SECRET,
            accessToken: process.env.ACCESS_TOKEN,
            refreshToken: process.env.REFRESH_TOKEN,
            redirectUri: process.env.REDIRECT_URI,
        },
        subreddits: {
            names: parseListFromEnv(process.env.SUBREDDITS),
            wikiConfig: process.env.WIKI_CONFIG,
            heartbeatInterval: process.env.HEARTBEAT !== undefined ? parseInt(process.env.HEARTBEAT) : undefined,
            dryRun: parseBool(process.env.DRYRUN, undefined),
        },
        logging: {
            // @ts-ignore
            level: process.env.LOG_LEVEL,
            path: process.env.LOG_DIR === 'true' ? `${process.cwd()}/logs` : undefined,
        },
        snoowrap: {
            proxy: process.env.PROXY,
            debug: parseBool(process.env.SNOO_DEBUG, undefined),
        },
        web: {
            enabled: process.env.WEB !== undefined ? parseBool(process.env.WEB) : undefined,
            port: process.env.PORT !== undefined ? parseInt(process.env.PORT) : undefined,
            session: {
                provider: process.env.SESSION_PROVIDER,
                secret: process.env.SESSION_SECRET
            }
        },
        polling: {
            sharedMod: parseBool(process.env.SHARE_MOD),
        },
        caching: {
            provider: {
                store: process.env.CACHING as (CacheProvider | undefined)
            },
            authorTTL: process.env.AUTHOR_TTL !== undefined ? parseInt(process.env.AUTHOR_TTL) : undefined
        },
        nanny: {
            softLimit: process.env.SOFT_LIMIT !== undefined ? parseInt(process.env.SOFT_LIMIT) : undefined,
            hardLimit: process.env.HARD_LIMIT !== undefined ? parseInt(process.env.HARD_LIMIT) : undefined
        }
    }

    return removeUndefinedKeys(data) as OperatorJsonConfig;
}

// Hierarchy (lower level overwrites above)
//
// .env file
// Actual ENVs (from environment)
// json config
// args from cli
export const parseOperatorConfigFromSources = async (args: any): Promise<OperatorJsonConfig> => {
    const {logLevel = process.env.LOG_LEVEL, logDir = process.env.LOG_DIR || false} = args || {};
    const envPath = process.env.OPERATOR_ENV;

    // create a pre config logger to help with debugging
    const initLogger = getLogger({logLevel, logDir: logDir === true ? `${process.cwd()}/logs` : logDir}, 'init');

    try {
        const vars = await GetEnvVars({
            envFile: {
                filePath: envPath,
                fallback: true
            }
        });
        // if we found variables in the file of at a fallback path then add them in before we do main arg parsing
        for (const [k, v] of Object.entries(vars)) {
            // don't override existing
            if (process.env[k] === undefined) {
                process.env[k] = v;
            }
        }
    } catch (err) {
        let msg = 'No .env file found at default location (./env)';
        if (envPath !== undefined) {
            msg = `${msg} or OPERATOR_ENV path (${envPath})`;
        }
        initLogger.warn(`${msg} -- this may be normal if neither was provided.`);
        // mimicking --silent from env-cmd
        //swallow silently for now 😬
    }

    const {operatorConfig = process.env.OPERATOR_CONFIG} = args;
    let configFromFile: OperatorJsonConfig = {};
    if (operatorConfig !== undefined) {
        let rawConfig;
        try {
            rawConfig = await readJson(operatorConfig, {log: initLogger});
        } catch (err) {
            initLogger.error('Cannot continue app startup because operator config file was not parseable.');
            err.logged = true;
            throw err;
        }
        try {
            configFromFile = validateJson(rawConfig, operatorSchema, initLogger) as OperatorJsonConfig;
        } catch (err) {
            initLogger.error('Cannot continue app startup because operator config file was not valid.');
            throw err;
        }
    }
    const configFromArgs = parseOpConfigFromArgs(args);
    const configFromEnv = parseOpConfigFromEnv();

    const mergedConfig = merge.all([configFromEnv, configFromFile, configFromArgs], {
        arrayMerge: overwriteMerge,
    });

    return removeUndefinedKeys(mergedConfig) as OperatorJsonConfig;
}

export const buildOperatorConfigWithDefaults = (data: OperatorJsonConfig): OperatorConfig => {
    const {
        operator: {
            name = [],
            display = 'Anonymous',
            botName,
        } = {},
        credentials: {
            clientId: ci,
            clientSecret: cs,
            ...restCred
        } = {},
        subreddits: {
            names = [],
            wikiConfig = 'botconfig/contextbot',
            heartbeatInterval = 300,
            dryRun
        } = {},
        logging: {
            level = 'verbose',
            path,
        } = {},
        snoowrap = {},
        web: {
            enabled = true,
            port = 8085,
            maxLogs = 200,
            session: {
                secret = randomId(),
                provider: sessionProvider = { store: 'memory' },
            } = {},
            clients,
        } = {},
        api: {
            port: apiPort = 8095,
            secret: apiSecret = randomId(),
        } = {},
        polling: {
            sharedMod = false,
            limit = 100,
            interval = 30,
        } = {},
        queue: {
            maxWorkers = 1,
        } = {},
        caching,
        nanny: {
            softLimit = 250,
            hardLimit = 50
        } = {},
    } = data;

    let cache: StrongCache;

    if(caching === undefined) {
        cache = {
            ...cacheTTLDefaults,
            provider: {
                store: 'memory',
                ...cacheOptDefaults
            }
        };
    } else {
        const {provider, ...restConfig} = caching;
        if (typeof provider === 'string') {
            cache = {
                ...cacheTTLDefaults,
                ...restConfig,
                provider: {
                    store: provider as CacheProvider,
                    ...cacheOptDefaults
                }
            }
        } else {
            const {ttl = 60, max = 500, store = 'memory', ...rest} = provider || {};
            cache = {
                ...cacheTTLDefaults,
                ...restConfig,
                provider: {
                    store,
                    ...cacheOptDefaults,
                    ...rest,
                },
            }
        }
    }

    const config: OperatorConfig = {
        operator: {
            name: typeof name === 'string' ? [name] : name,
            display,
            botName,
        },
        credentials: {
            clientId: (ci as string),
            clientSecret: (cs as string),
            ...restCred,
        },
        logging: {
            level,
            path
        },
        snoowrap,
        subreddits: {
            names,
            wikiConfig,
            heartbeatInterval,
            dryRun,
        },
        web: {
            enabled,
            port,
            session: {
                secret,
                provider: typeof sessionProvider === 'string' ? {
                    ...buildCacheOptionsFromProvider({
                        ttl: 86400000,
                        store: sessionProvider,
                    })
                } : {
                    ...buildCacheOptionsFromProvider(sessionProvider),
                    ttl: 86400000,
                },
            },
            maxLogs,
            clients: clients === undefined ? [{host: 'http://localhost', port: apiPort, secret: apiSecret}] : clients,
        },
        api: {
            port: apiPort,
            secret: apiSecret
        },
        caching: cache,
        polling: {
            sharedMod,
            limit,
            interval,
        },
        queue: {
          maxWorkers,
        },
        nanny: {
            softLimit,
            hardLimit
        }
    };

    return config;
}
