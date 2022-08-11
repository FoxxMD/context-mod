import winston, {Logger} from "winston";
import dayjs, {Dayjs} from "dayjs";
import {getLogger} from "./Utils/loggerFactory";
import {DatabaseMigrationOptions, OperatorConfig, OperatorConfigWithFileContext, OperatorFileConfig} from "./Common/interfaces";
import Bot from "./Bot";
import LoggedError from "./Utils/LoggedError";
import {generateRandomName, mergeArr, sleep} from "./util";
import {copyFile, open} from "fs/promises";
import {constants} from "fs";
import {Connection, DataSource, Repository} from "typeorm";
import {ErrorWithCause} from "pony-cause";
import {MigrationService} from "./Common/MigrationService";
import {Invokee} from "./Common/Infrastructure/Atomic";
import {DatabaseConfig} from "./Common/Infrastructure/Database";
import {InviteData} from "./Web/Common/interfaces";
import {BotInvite} from "./Common/Entities/BotInvite";

export class App {

    bots: Bot[] = [];
    logger: Logger;
    dbLogger: Logger;
    database: DataSource
    startedAt: Dayjs = dayjs();
    ranMigrations: boolean = false;
    migrationBlocker?: string;
    friendly?: string;

    config: OperatorConfig;

    error: any;

    fileConfig: OperatorFileConfig;

    migrationService: MigrationService;
    inviteRepo: Repository<BotInvite>;

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
        this.dbLogger = this.logger.child({labels: ['Database']}, mergeArr);
        this.database = database;
        this.inviteRepo = this.database.getRepository(BotInvite);
        this.friendly = this.config.api.friendly;

        this.logger.info(`Operators: ${name.length === 0 ? 'None Specified' : name.join(', ')}`)

        this.migrationService = new MigrationService({
            type: 'app',
            logger: this.logger,
            database,
            options: this.config.databaseConfig.migrations
        });

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
        await this.migrationService.doMigration();
        this.migrationBlocker = undefined;
        this.ranMigrations = true;
    }

    async backupDatabase() {
        await this.migrationService.backupDatabase();
    }

    async initDatabase() {
        const [migrated, blocker] = await this.migrationService.initDatabase();
        this.migrationBlocker = blocker;
        this.ranMigrations = migrated;
        return this.ranMigrations;
    }

    async initBots(causedBy: Invokee = 'system') {
        if(!this.ranMigrations) {
            this.logger.error('Must run migrations before starting bots');
            return;
        }

        await this.checkFriendlyName();

        if(this.bots.length > 0) {
            this.logger.info('Bots already exist, will stop and destroy these before building new ones.');
            await this.destroy(causedBy);
        }
        const {
            bots = [],
        } = this.config;

        if(bots.length === 0) {
            this.logger.warn('No bots were parsed from config! Add new bots from the web dashboard');
        } else {
            this.logger.verbose('Building bots...')
        }

        this.bots = bots.map(x => new Bot(x, this.logger));

        for (const b of this.bots) {
            if (b.error === undefined) {
                try {
                    await b.init();
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

    async checkFriendlyName() {
        if(this.friendly === undefined) {
            let randFriendly: string = generateRandomName();
            this.logger.verbose(`No friendly name set for Server. Generated: ${randFriendly}`);

            const exists = async (name: string) => {
                const existing = await this.inviteRepo.findBy({instance: name});
                return existing.length > 0;
            }
            while (await exists(randFriendly)) {
                let oldFriendly = randFriendly;
                randFriendly = generateRandomName();
                this.logger.verbose(`${oldFriendly} already exists! Generated: ${randFriendly}`);
            }

            this.friendly = randFriendly;
            this.fileConfig.document.setFriendlyName(this.friendly);

            const handle = await open(this.fileConfig.document.location as string, 'w');
            await handle.writeFile(this.fileConfig.document.toString());
            await handle.close();
            this.logger.verbose(`Wrote ${randFriendly} as friendly server name to config.`);
        }
    }

    async getInviteById(id: string): Promise<BotInvite | undefined> {
        const invite = await this.inviteRepo.findOne({where: {id, instance: this.friendly}});
        if(invite === null) {
            return undefined;
        }
        return invite;
    }

    async getInviteIds(): Promise<string[]> {
        if(!this.ranMigrations) {
            // not ready!
            return [];
        }
        const invites = await this.inviteRepo.findBy({instance: this.friendly});
        return invites.map(x => x.id);
    }

    async addInvite(data: InviteData): Promise<InviteData> {
        return await this.inviteRepo.save(new BotInvite(data));
    }

    async deleteInvite(id: string): Promise<void> {
        await this.inviteRepo.delete({ id });
    }
}
