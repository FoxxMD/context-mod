import {Logger} from "winston";
import {
    buildCacheOptionsFromProvider, buildCachePrefix,
    createAjvFactory, fileOrDirectoryIsWriteable,
    mergeArr,
    normalizeName,
    overwriteMerge,
    parseBool, parseFromJsonOrYamlToObject, randomId,
    readConfigFile, removeFromSourceIfKeysExistsInDestination,
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
    PollOn,
    StrongCache,
    CacheProvider,
    CacheOptions,
    BotInstanceJsonConfig,
    BotInstanceConfig,
    RequiredWebRedditCredentials,
    RedditCredentials,
    BotCredentialsJsonConfig,
    BotCredentialsConfig,
    FilterCriteriaDefaults, TypedActivityStates, OperatorFileConfig, PostBehavior
} from "./Common/interfaces";
import {isRuleSetJSON, RuleSetJson, RuleSetObjectJson} from "./Rule/RuleSet";
import deepEqual from "fast-deep-equal";
import {ActionJson, ActionObjectJson, ConfigFormat, RuleJson, RuleObjectJson} from "./Common/types";
import {isActionJson} from "./Action";
import {getLogger} from "./Utils/loggerFactory";
import {GetEnvVars} from 'env-cmd';
import {operatorConfig} from "./Utils/CommandConfig";
import merge from 'deepmerge';
import * as process from "process";
import {cacheOptDefaults, cacheTTLDefaults, filterCriteriaDefault} from "./Common/defaults";
import objectHash from "object-hash";
import {AuthorCriteria, AuthorOptions} from "./Author/Author";
import path from 'path';
import {
    JsonOperatorConfigDocument,
    OperatorConfigDocumentInterface,
    YamlOperatorConfigDocument
} from "./Common/Config/Operator";
import {ConfigDocumentInterface} from "./Common/Config/AbstractConfigDocument";
import {Document as YamlDocument} from "yaml";
import {SimpleError} from "./Utils/Errors";
import {ErrorWithCause} from "pony-cause";
import {RunStructuredJson} from "./Run";

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

    parseToStructured(config: JSONConfig, filterCriteriaDefaultsFromBot?: FilterCriteriaDefaults, postCheckBehaviorDefaultsFromBot: PostBehavior = {}): RunStructuredJson[] {
        let namedRules: Map<string, RuleObjectJson> = new Map();
        let namedActions: Map<string, ActionObjectJson> = new Map();
        const {checks = [], runs = [], filterCriteriaDefaults, postCheckBehaviorDefaults} = config;

        if(checks.length > 0 && runs.length > 0) {
            // cannot have both checks and runs at top-level
            throw new Error(`Subreddit configuration cannot contain both 'checks' and 'runs' at top-level.`);
        }

        const realRuns  = runs;
        if(checks.length > 0) {
            realRuns.push({name: 'Run1', checks: checks});
        }

        for(const r of realRuns) {
            for (const c of r.checks) {
                const {rules = []} = c;
                namedRules = extractNamedRules(rules, namedRules);
                namedActions = extractNamedActions(c.actions, namedActions);
            }
        }

        const structuredRuns: RunStructuredJson[] = [];

        for(const r of realRuns) {

            const {filterCriteriaDefaults: filterCriteriaDefaultsFromRun, postFail, postTrigger } = r;

            const filterDefs = filterCriteriaDefaultsFromRun ?? (filterCriteriaDefaults ?? filterCriteriaDefaultsFromBot);
            const {
                authorIsBehavior = 'merge',
                itemIsBehavior = 'merge',
                authorIs: authorIsDefault = {},
                itemIs: itemIsDefault = []
            } = filterDefs || {};

            const structuredChecks: CheckStructuredJson[] = [];
            for (const c of r.checks) {
                const {rules = [], authorIs = {}, itemIs = []} = c;
                const strongRules = insertNamedRules(rules, namedRules);
                const strongActions = insertNamedActions(c.actions, namedActions);

                let derivedAuthorIs: AuthorOptions = authorIsDefault;
                if (authorIsBehavior === 'merge') {
                    derivedAuthorIs = merge.all([authorIs, authorIsDefault], {arrayMerge: removeFromSourceIfKeysExistsInDestination});
                } else if (Object.keys(authorIs).length > 0) {
                    derivedAuthorIs = authorIs;
                }

                let derivedItemIs: TypedActivityStates = itemIsDefault;
                if (itemIsBehavior === 'merge') {
                    derivedItemIs = [...itemIs, ...itemIsDefault];
                } else if (itemIs.length > 0) {
                    derivedItemIs = itemIs;
                }

                const postCheckBehaviors = Object.assign({}, postCheckBehaviorDefaultsFromBot, removeUndefinedKeys({postFail, postTrigger}));

                const strongCheck = {
                    ...c,
                    authorIs: derivedAuthorIs,
                    itemIs: derivedItemIs,
                    rules: strongRules,
                    actions: strongActions,
                    ...postCheckBehaviors
                } as CheckStructuredJson;
                structuredChecks.push(strongCheck);
            }
            structuredRuns.push({...r, checks: structuredChecks});
        }

        return structuredRuns;
    }
}

export const buildPollingOptions = (values: (string | PollingOptions)[]): PollingOptionsStrong[] => {
    let opts: PollingOptionsStrong[] = [];
    for (const v of values) {
        if (typeof v === 'string') {
            opts.push({
                pollOn: v as PollOn,
                interval: DEFAULT_POLLING_INTERVAL,
                limit: DEFAULT_POLLING_LIMIT,
            });
        } else {
            const {
                pollOn: p,
                interval = DEFAULT_POLLING_INTERVAL,
                limit = DEFAULT_POLLING_LIMIT,
                delayUntil,
            } = v;
            opts.push({
                pollOn: p as PollOn,
                interval,
                limit,
                delayUntil,
            });
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

export const parseDefaultBotInstanceFromArgs = (args: any): BotInstanceJsonConfig => {
    const {
        subreddits,
        clientId,
        clientSecret,
        accessToken,
        refreshToken,
        wikiConfig,
        dryRun,
        softLimit,
        heartbeat,
        hardLimit,
        authorTTL,
        sharedMod,
        caching,
    } = args || {};

    const data = {
        credentials: {
            clientId,
            clientSecret,
            accessToken,
            refreshToken,
        },
        subreddits: {
            names: subreddits,
            wikiConfig,
            dryRun,
            heartbeatInterval: heartbeat,
        },
        polling: {
            shared: sharedMod ? ['unmoderated', 'modqueue'] : undefined,
        },
        nanny: {
            softLimit,
            hardLimit
        }
    }
    return removeUndefinedKeys(data) as BotInstanceJsonConfig;
}

export const parseOpConfigFromArgs = (args: any): OperatorJsonConfig => {
    const {
        clientId,
        clientSecret,
        redirectUri,
        operator,
        operatorDisplay,
        logLevel,
        logDir,
        port,
        sessionSecret,
        web,
        mode,
        caching,
        authorTTL,
        snooProxy,
        snooDebug,
    } = args || {};

    const data = {
        mode,
        operator: {
            name: operator,
            display: operatorDisplay
        },
        logging: {
            level: logLevel,
            file: {
                level: logLevel,
                dirName: logDir,
            },
            stream: {
                level: logLevel,
            },
            console: {
                level: logLevel,
            }
        },
        caching: {
            provider: caching,
            authorTTL
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
            },
            credentials: {
                clientId,
                clientSecret,
                redirectUri,
            }
        }
    }

    return removeUndefinedKeys(data) as OperatorJsonConfig;
}

const parseListFromEnv = (val: string | undefined) => {
    let listVals: undefined | string[];
    if (val === undefined) {
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

export const parseDefaultBotInstanceFromEnv = (): BotInstanceJsonConfig => {
    const data = {
        credentials: {
            reddit: {
                clientId: process.env.CLIENT_ID,
                clientSecret: process.env.CLIENT_SECRET,
                accessToken: process.env.ACCESS_TOKEN,
                refreshToken: process.env.REFRESH_TOKEN,
            },
            youtube: process.env.YOUTUBE_API_KEY
        },
        subreddits: {
            names: parseListFromEnv(process.env.SUBREDDITS),
            wikiConfig: process.env.WIKI_CONFIG,
            dryRun: parseBool(process.env.DRYRUN, undefined),
            heartbeatInterval: process.env.HEARTBEAT !== undefined ? parseInt(process.env.HEARTBEAT) : undefined,
        },
        polling: {
            shared: parseBool(process.env.SHARE_MOD) ? ['unmoderated', 'modqueue'] : undefined,
        },
        nanny: {
            softLimit: process.env.SOFT_LIMIT !== undefined ? parseInt(process.env.SOFT_LIMIT) : undefined,
            hardLimit: process.env.HARD_LIMIT !== undefined ? parseInt(process.env.HARD_LIMIT) : undefined
        },
    };
    return removeUndefinedKeys(data) as BotInstanceJsonConfig;
}

export const parseOpConfigFromEnv = (): OperatorJsonConfig => {
    const data = {
        mode: process.env.MODE !== undefined ? process.env.MODE as ('all' | 'server' | 'client') : undefined,
        operator: {
            name: parseListFromEnv(process.env.OPERATOR),
            display: process.env.OPERATOR_DISPLAY
        },
        logging: {
            level: process.env.LOG_LEVEL,
            file: {
                level: process.env.LOG_LEVEL,
                dirname: process.env.LOG_DIR,
            },
            stream: {
                level: process.env.LOG_LEVEL,
            },
            console: {
                level: process.env.LOG_LEVEL,
            }
        },
        caching: {
            provider: {
                // @ts-ignore
                store: process.env.CACHING as (CacheProvider | undefined)
            },
            authorTTL: process.env.AUTHOR_TTL !== undefined ? parseInt(process.env.AUTHOR_TTL) : undefined
        },
        snoowrap: {
            proxy: process.env.PROXY,
            debug: parseBool(process.env.SNOO_DEBUG, undefined),
        },
        web: {
            port: process.env.PORT !== undefined ? parseInt(process.env.PORT) : undefined,
            session: {
                provider: process.env.SESSION_PROVIDER,
                secret: process.env.SESSION_SECRET
            },
            credentials: {
                clientId: process.env.CLIENT_ID,
                clientSecret: process.env.CLIENT_SECRET,
                redirectUri: process.env.REDIRECT_URI,
            },
        },
        credentials: {
            youtube: {
                apiKey: process.env.YOUTUBE_API_KEY
            }
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
export const parseOperatorConfigFromSources = async (args: any): Promise<[OperatorJsonConfig, OperatorFileConfig]> => {
    const {logLevel = process.env.LOG_LEVEL ?? 'debug', logDir = process.env.LOG_DIR} = args || {};
    const envPath = process.env.OPERATOR_ENV;
    const initLoggerOptions = {
        level: logLevel,
        console: {
            level: logLevel
        },
        file: {
            level: logLevel,
            dirname: logDir,
        },
        stream: {
            level: logLevel
        }
    }

    // create a pre config logger to help with debugging
    // default to debug if nothing is provided
    const initLogger = getLogger(initLoggerOptions, 'init');

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
    } catch (err: any) {
        let msg = 'No .env file found at default location (./env)';
        if (envPath !== undefined) {
            msg = `${msg} or OPERATOR_ENV path (${envPath})`;
        }
        initLogger.warn(`${msg} -- this may be normal if neither was provided.`);
        // mimicking --silent from env-cmd
        //swallow silently for now 😬
    }

    const {operatorConfig = (process.env.OPERATOR_CONFIG ?? path.resolve(__dirname, '../config.yaml'))} = args;
    let configFromFile: OperatorJsonConfig = {};
    let fileConfigFormat: ConfigFormat | undefined = undefined;
    let fileConfig: object = {};
    let rawConfig: string = '';
    let configDoc: YamlOperatorConfigDocument | JsonOperatorConfigDocument;
    let writeable = false;
    try {
        writeable = await fileOrDirectoryIsWriteable(operatorConfig);
    } catch (e) {
        initLogger.warn(`Issue while parsing operator config file location: ${e} \n This is only a problem if you do not have a config file but are planning on adding bots interactively.`);
    }

    try {
        const [rawConfigValue, format] = await readConfigFile(operatorConfig, {log: initLogger});
        rawConfig = rawConfigValue ?? '';
        fileConfigFormat = format as ConfigFormat;
    } catch (err: any) {
        const {code} = err;
        if (code === 'ENOENT') {
            initLogger.warn('No operator config file found but will continue');
            if (err.extension !== undefined) {
                fileConfigFormat = err.extension
            }
        } else {
            throw new ErrorWithCause('Cannot continue app startup because operator config file exists but was not parseable.', {cause: err});
        }
    }
    const [format, doc, jsonErr, yamlErr] = parseFromJsonOrYamlToObject(rawConfig, {
        location: operatorConfig,
        jsonDocFunc: (content, location) => new JsonOperatorConfigDocument(content, location),
        yamlDocFunc: (content, location) => new YamlOperatorConfigDocument(content, location)
    });


    if (format !== undefined && fileConfigFormat === undefined) {
        fileConfigFormat = 'yaml';
    }

    if (doc === undefined && rawConfig !== '') {
        initLogger.error(`Could not parse file contents at ${operatorConfig} as JSON or YAML (likely it is ${fileConfigFormat}):`);
        initLogger.error(jsonErr);
        initLogger.error(yamlErr);
        throw new SimpleError(`Could not parse file contents at ${operatorConfig} as JSON or YAML`);
    } else if (doc === undefined && rawConfig === '') {
        // create an empty doc
        if(fileConfigFormat === 'json') {
            configDoc = new JsonOperatorConfigDocument('{}', operatorConfig);
        } else {
            configDoc = new YamlOperatorConfigDocument('', operatorConfig);
            configDoc.parsed = new YamlDocument({});
        }
        configFromFile = {};
    } else {
        configDoc = doc as (YamlOperatorConfigDocument | JsonOperatorConfigDocument);

        try {
            configFromFile = validateJson(configDoc.toJS(), operatorSchema, initLogger) as OperatorJsonConfig;
            const {
                bots = [],
                logging: {
                    path = undefined
                } = {}
            } = configFromFile || {};
            if(path !== undefined) {
                initLogger.warn(`'path' property in top-level 'logging' object is DEPRECATED and will be removed in next minor version. Use 'logging.file.dirname' instead`);
            }
            for (const b of bots) {
                const {
                    polling: {
                        sharedMod
                    } = {}
                } = b;
                if (sharedMod !== undefined) {
                    initLogger.warn(`'sharedMod' bot config property is DEPRECATED and will be removed in next minor version. Use 'shared' property instead (see docs)`);
                    break;
                }
            }
        } catch (err: any) {
            initLogger.error('Cannot continue app startup because operator config file was not valid.');
            throw err;
        }
    }

    const opConfigFromArgs = parseOpConfigFromArgs(args);
    const opConfigFromEnv = parseOpConfigFromEnv();

    const defaultBotInstanceFromArgs = parseDefaultBotInstanceFromArgs(args);
    const defaultBotInstanceFromEnv = parseDefaultBotInstanceFromEnv();
    const {bots: botInstancesFromFile = [], ...restConfigFile} = configFromFile;

    const mergedConfig = merge.all([opConfigFromEnv, restConfigFile, opConfigFromArgs], {
        arrayMerge: overwriteMerge,
    });

    const defaultBotInstance = merge.all([defaultBotInstanceFromEnv, defaultBotInstanceFromArgs], {
        arrayMerge: overwriteMerge,
    }) as BotInstanceJsonConfig;

    if (configFromFile.caching !== undefined) {
        defaultBotInstance.caching = configFromFile.caching;
    }

    let botInstances = [];
    if (botInstancesFromFile.length === 0) {
        botInstances = [defaultBotInstance];
    } else {
        botInstances = botInstancesFromFile.map(x => merge.all([defaultBotInstance, x], {arrayMerge: overwriteMerge}));
    }

    return [removeUndefinedKeys({...mergedConfig, bots: botInstances}) as OperatorJsonConfig, {
        document: configDoc,
        isWriteable: writeable
    }];
}

export const buildOperatorConfigWithDefaults = (data: OperatorJsonConfig): OperatorConfig => {
    const {
        mode = 'all',
        operator: {
            name = [],
            display = 'Anonymous',
        } = {},
        logging: {
            level = 'verbose',
            path,
            file = {},
            console = {},
            stream = {},
        } = {},
        caching: opCache,
        web: {
            port = 8085,
            maxLogs = 200,
            caching: webCaching = {},
            session: {
                secret = randomId(),
                maxAge: sessionMaxAge = 86400,
            } = {},
            invites: {
                maxAge: inviteMaxAge = 0,
            } = {},
            clients,
            credentials: webCredentials,
            operators,
        } = {},
        snoowrap: snoowrapOp = {},
        api: {
            port: apiPort = 8095,
            secret: apiSecret = randomId(),
            friendly,
        } = {},
        credentials = {},
        bots = [],
    } = data;

    let cache: StrongCache;
    let defaultProvider: CacheOptions;
    let opActionedEventsMax: number | undefined;
    let opActionedEventsDefault: number = 25;

    if (opCache === undefined) {
        defaultProvider = {
            store: 'memory',
            ...cacheOptDefaults
        };
        cache = {
            ...cacheTTLDefaults,
            provider: defaultProvider,
            actionedEventsDefault: opActionedEventsDefault,
        };

    } else {
        const {provider, actionedEventsMax, actionedEventsDefault = opActionedEventsDefault, ...restConfig} = opCache;

        if (actionedEventsMax !== undefined && actionedEventsMax !== null) {
            opActionedEventsMax = actionedEventsMax;
            opActionedEventsDefault = Math.min(actionedEventsDefault, actionedEventsMax);
        }

        if (typeof provider === 'string') {
            defaultProvider = {
                store: provider as CacheProvider,
                ...cacheOptDefaults
            };
        } else {
            const {ttl = 60, max = 500, store = 'memory', ...rest} = provider || {};
            defaultProvider = {
                store,
                ...cacheOptDefaults,
                ...rest,
            };
        }
        cache = {
            ...cacheTTLDefaults,
            ...restConfig,
            actionedEventsMax: opActionedEventsMax,
            actionedEventsDefault: opActionedEventsDefault,
            provider: defaultProvider,
        }
    }

    const defaultOperators = typeof name === 'string' ? [name] : name;

    const {
        dirname = path,
        ...fileRest
    } = file;


    const config: OperatorConfig = {
        mode,
        operator: {
            name: defaultOperators,
            display,
        },
        logging: {
            level,
            file: {
                level: level,
                dirname,
                ...fileRest,
            },
            stream: {
                level: level,
                ...stream,
            },
            console: {
                level: level,
                ...console,
            }
        },
        caching: cache,
        web: {
            port,
            caching: {
                ...defaultProvider,
                ...webCaching
            },
            invites: {
                maxAge: inviteMaxAge,
            },
            session: {
                secret,
                maxAge: sessionMaxAge,
            },
            maxLogs,
            clients: clients === undefined ? [{host: 'localhost:8095', secret: apiSecret}] : clients,
            credentials: webCredentials as RequiredWebRedditCredentials,
            operators: operators || defaultOperators,
        },
        api: {
            port: apiPort,
            secret: apiSecret,
            friendly
        },
        bots: [],
        credentials,
    };

    config.bots = bots.map(x => buildBotConfig(x, config));

    return config;
}

export const buildBotConfig = (data: BotInstanceJsonConfig, opConfig: OperatorConfig): BotInstanceConfig => {
    const {
        snoowrap: snoowrapOp,
        caching: {
            actionedEventsMax: opActionedEventsMax,
            actionedEventsDefault: opActionedEventsDefault = 25,
            provider: defaultProvider,
        } = {}
    } = opConfig;
    const {
        name: botName,
        filterCriteriaDefaults = filterCriteriaDefault,
        postCheckBehaviorDefaults,
        polling: {
            sharedMod,
            shared = [],
            stagger,
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
        snoowrap = snoowrapOp,
        credentials = {},
        subreddits: {
            names = [],
            exclude = [],
            wikiConfig = 'botconfig/contextbot',
            dryRun,
            heartbeatInterval = 300,
        } = {},
    } = data;

    let botCache: StrongCache;
    let botActionedEventsDefault: number;

    if (caching === undefined) {

        botCache = {
            ...cacheTTLDefaults,
            actionedEventsDefault: opActionedEventsDefault,
            actionedEventsMax: opActionedEventsMax,
            provider: {...defaultProvider as CacheOptions}
        };
    } else {
        const {
            provider,
            actionedEventsMax = opActionedEventsMax,
            actionedEventsDefault = opActionedEventsDefault,
            ...restConfig
        } = caching;

        botActionedEventsDefault = actionedEventsDefault;
        if (actionedEventsMax !== undefined) {
            botActionedEventsDefault = Math.min(actionedEventsDefault, actionedEventsMax);
        }

        if (typeof provider === 'string') {
            botCache = {
                ...cacheTTLDefaults,
                ...restConfig,
                actionedEventsDefault: botActionedEventsDefault,
                provider: {
                    store: provider as CacheProvider,
                    ...cacheOptDefaults
                }
            }
        } else {
            const {ttl = 60, max = 500, store = 'memory', ...rest} = provider || {};
            botCache = {
                ...cacheTTLDefaults,
                ...restConfig,
                actionedEventsDefault: botActionedEventsDefault,
                actionedEventsMax,
                provider: {
                    store,
                    ...cacheOptDefaults,
                    ...rest,
                },
            }
        }
    }

    let botCreds: BotCredentialsConfig;

    if ((credentials as any).clientId !== undefined) {
        const creds = credentials as RedditCredentials;
        const {
            clientId: ci,
            clientSecret: cs,
            ...restCred
        } = creds;
        botCreds = {
            reddit: {
                clientId: (ci as string),
                clientSecret: (cs as string),
                ...restCred,
            }
        }
    } else {
        const creds = credentials as BotCredentialsJsonConfig;
        const {
            reddit: {
                clientId: ci,
                clientSecret: cs,
                ...restRedditCreds
            },
            ...rest
        } = creds;
        botCreds = {
            reddit: {
                clientId: (ci as string),
                clientSecret: (cs as string),
                ...restRedditCreds,
            },
            ...rest
        }
    }

    if (botCache.provider.prefix === undefined || botCache.provider.prefix === (defaultProvider as CacheOptions).prefix) {
        // need to provide unique prefix to bot
        botCache.provider.prefix = buildCachePrefix([botCache.provider.prefix, 'bot', (botName || objectHash.sha1(botCreds))]);
    }

    let realShared = shared === true ? ['unmoderated', 'modqueue', 'newComm', 'newSub'] : shared;
    if (sharedMod === true) {
        realShared.push('unmoderated');
        realShared.push('modqueue');
    }

    return {
        name: botName,
        snoowrap: snoowrap || {},
        filterCriteriaDefaults,
        postCheckBehaviorDefaults,
        subreddits: {
            names,
            exclude,
            wikiConfig,
            heartbeatInterval,
            dryRun,
        },
        credentials: botCreds,
        caching: botCache,
        polling: {
            shared: [...new Set(realShared)] as PollOn[],
            stagger,
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
    }
}
