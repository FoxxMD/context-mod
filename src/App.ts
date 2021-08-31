import winston, {Logger} from "winston";
import dayjs, {Dayjs} from "dayjs";
import {getLogger} from "./Utils/loggerFactory";
import {Invokee, OperatorConfig} from "./Common/interfaces";
import Bot from "./Bot";
import LoggedError from "./Utils/LoggedError";

export class App {

    bots: Bot[]
    logger: Logger;
    startedAt: Dayjs = dayjs();

    error: any;

    constructor(config: OperatorConfig) {
        const {
            operator: {
                name,
            },
            notifications,
            bots = [],
        } = config;

        this.logger = getLogger(config.logging);

        this.logger.info(`Operators: ${name.length === 0 ? 'None Specified' : name.join(', ')}`)

        this.bots = bots.map(x => new Bot(x, this.logger));

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

    async initBots(causedBy: Invokee = 'system') {
        for (const b of this.bots) {
            if (b.error === undefined) {
                try {
                    await b.testClient();
                    await b.buildManagers();
                    b.runManagers(causedBy).catch((err) => {
                        this.logger.error(`Unexpected error occurred while running Bot ${b.botName}. Bot must be re-built to restart`);
                        if (!err.logged || !(err instanceof LoggedError)) {
                            this.logger.error(err);
                        }
                    });
                } catch (err) {
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
