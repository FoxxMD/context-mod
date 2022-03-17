import winston, {Logger} from "winston";
import dayjs, {Dayjs} from "dayjs";
import {getLogger} from "./Utils/loggerFactory";
import {DatabaseConfig, DatabaseMigrationOptions, Invokee, OperatorConfig, OperatorConfigWithFileContext, OperatorFileConfig} from "./Common/interfaces";
import Bot from "./Bot";
import LoggedError from "./Utils/LoggedError";
import {mergeArr, sleep} from "./util";
import {copyFile} from "fs/promises";
import {constants} from "fs";
import {Connection} from "typeorm";

export class App {

    bots: Bot[] = [];
    logger: Logger;
    dbLogger: Logger;
    database: Connection
    startedAt: Dayjs = dayjs();
    ranMigrations: boolean = false;
    migrationBlocker?: string;

    config: OperatorConfig;

    error: any;

    config: OperatorConfig;
    fileConfig: OperatorFileConfig;

    constructor(config: OperatorConfigWithFileContext) {
        const {
            database,
            operator: {
                name,
            },
            notifications,
            bots = [],
        } = config;

        const {fileConfig, ...rest} = config;

        this.config = rest;
        this.fileConfig = fileConfig;

        this.logger = getLogger(config.logging);
        this.dbLogger = this.logger.child({leaf: 'Database'}, mergeArr);
        this.database = database;

        this.logger.info(`Operators: ${name.length === 0 ? 'None Specified' : name.join(', ')}`)

        process.on('uncaughtException', (e) => {
            this.error = e;
        });
        process.on('unhandledRejection', (e) => {
            this.error = e;
        });
        process.on('exit', async (code) => {
            if(code === 0) {
                await this.onTerminate();
            } else if(this.error !== undefined) {
                let errMsg;
                if(typeof this.error === 'object' && this.error.message !== undefined) {
                    errMsg = this.error.message;
                } else if(typeof this.error === 'string') {
                    errMsg = this.error;
                }
                await this.onTerminate(`Application exited due to an unexpected error${errMsg !== undefined ? `: ${errMsg}` : ''}`);
            } else {
                await this.onTerminate(`Application exited with unclean exit signal (${code})`);
            }
        });
    }

    async onTerminate(reason = 'The application was shutdown') {
        for(const b of this.bots) {
            for(const m of b.subManagers) {
                await m.notificationManager.handle('runStateChanged', 'Application Shutdown', reason);
            }
            //await b.notificationManager.handle('runStateChanged', 'Application Shutdown', reason);
        }
    }

    async doMigration() {
        if (this.database.options.type === 'sqljs' && this.database.options.location !== undefined) {
            const ts = Date.now();
            const backupLocation = `${this.database.options.location}.${ts}.bak`
            this.dbLogger.info(`Detected sqljs (sqlite) database. Will try to make a backup at ${backupLocation} before migrating.`);
            try {
                await copyFile(this.database.options.location, backupLocation, constants.COPYFILE_EXCL);
                this.dbLogger.info('Successfully created backup!');
            } catch (e: any) {
                this.dbLogger.error(`Could not create a backup but will continue with migration: ${e.message}`);
            }
        }
        this.dbLogger.info('Beginning migrations...');
        await this.database.runMigrations();
        this.migrationBlocker = undefined;
        this.ranMigrations = true;
    }

    async initDatabase(confirm: boolean = false) {
        const {
            databaseConfig: {
                migrations: {
                    force = false,
                } = {}
            } = {},
        } = this.config;

        this.dbLogger.info('Checking if migrations are required...');

        const runner = this.database.createQueryRunner();
        const tables = await runner.getTables();
        if (tables.length === 0 || (tables.length === 1 && tables.map(x => x.name).includes('migrations'))) {
            this.dbLogger.info('Detected a new database! Starting migrations...');
            await this.database.showMigrations();
            await this.doMigration();
            return true;
        } else if (!tables.map(x => x.name).includes('migrations') && !force && !confirm) {
            this.dbLogger.warn(`DANGER! Your database has existing tables but none of them include a 'migrations' table. 
            Are you sure this is the correct database? Continuing with migrations will most likely drop any existing data and recreate all tables.`);
            this.migrationBlocker = 'unknownTables';
            return false;
        } else if (await this.database.showMigrations()) {
            this.dbLogger.info('Detected pending migrations.');
            if (!force && !confirm) {
                this.dbLogger.error(`You must confirm migrations. Either set 'force: true' in database config or confirm migrations from web interface.
YOU SHOULD BACKUP YOUR EXISTING DATABASE BEFORE CONTINUING WITH MIGRATIONS.`);
                this.migrationBlocker = 'pending';
                return false;
            }
            if (force && !confirm) {
                this.dbLogger.info('Migration was forced');
            }
            await this.doMigration();
            return true;
        } else {
            this.dbLogger.info('No migrations required!');
            this.ranMigrations = true;
            return true;
        }
    }

    async initBots(causedBy: Invokee = 'system') {
        if(!this.ranMigrations) {
            this.logger.error('Must run migrations before starting bots');
            return;
        }

        if(this.bots.length > 0) {
            this.logger.info('Bots already exist, will stop and destroy these before building new ones.');
            await this.destroy(causedBy);
        }
        const {
            bots = [],
        } = this.config;

        this.bots = bots.map(x => new Bot(x, this.logger));

        for (const b of this.bots) {
            if (b.error === undefined) {
                try {
                    await b.testClient();
                    await b.buildManagers();
                    await sleep(2000);
                    b.runManagers(causedBy).catch((err) => {
                        this.logger.error(`Unexpected error occurred while running Bot ${b.botName}. Bot must be re-built to restart`);
                        if (!err.logged || !(err instanceof LoggedError)) {
                            this.logger.error(err);
                        }
                    });
                } catch (err: any) {
                    if (b.error === undefined) {
                        b.error = err.message;
                    }
                    this.logger.error(`Bot ${b.botName} cannot recover from this error and must be re-built`);
                    if (!err.logged || !(err instanceof LoggedError)) {
                        this.logger.error(err);
                    }
                }
            }
        }
    }

    async destroy(causedBy: Invokee) {
        this.logger.info('Stopping all bots...');
        for(const b of this.bots) {
            await b.destroy(causedBy);
        }
    }
}
