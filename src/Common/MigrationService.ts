import {Logger} from "winston";
import {DataSource} from "typeorm";
import {intersect, mergeArr} from "../util";
import {DatabaseMigrationOptions} from "./interfaces";
import {copyFile} from "fs/promises";
import {constants} from "fs";
import {ErrorWithCause} from "pony-cause";

export class MigrationService {
    dbLogger: Logger;
    database: DataSource;
    options: DatabaseMigrationOptions;

    constructor(data: {
        type: 'app' | 'web',
        logger: Logger,
        database: DataSource,
        options: DatabaseMigrationOptions
    }) {
        this.dbLogger = data.logger.child({labels: [`Database`, (data.type === 'app' ? 'App' : 'Web')]}, mergeArr);
        this.database = data.database;
        this.options = data.options;
    }

    async initDatabase(): Promise<[boolean, string?]> {
        const {
            force = false,
            continueOnAutomatedBackup = false
        } = this.options || {};

        this.dbLogger.info('Checking if migrations are required...');

        const runner = this.database.createQueryRunner();
        const existingTables = await runner.getTables();
        const potentialTables = this.database.entityMetadatas.map(x => x.tableName);

        const blankDb = existingTables.length === 0 || (existingTables.length === 1 && existingTables.map(x => x.name).includes('migrations'));
        const conflictingTables = intersect(existingTables.map(x => x.name), potentialTables)

        if (blankDb || conflictingTables.length === 0) {
            if(blankDb) {
                this.dbLogger.info('Detected a new database with no tables!');
            } else {
                this.dbLogger.info('Database has existing tables/schema (may be system tables) but none conflict with potential application tables!');
            }
            await this.database.showMigrations();
            await this.doMigration();
            return [true];
        }

        if (!existingTables.map(x => x.name).some(x => x.toLocaleLowerCase().includes('migrations')) && !force) {
            this.dbLogger.warn(`DANGER! Your database has existing tables but none of them include a 'migrations' table. 
            Are you sure this is the correct database? Continuing with migrations will most likely drop any existing data and recreate all tables.`);
            return [false, 'unknownTables'];
        }
        if (await this.database.showMigrations()) {
            this.dbLogger.info('Detected pending migrations.');

            // try sqlite backup path
            let continueBCBackedup = false;
            if (continueOnAutomatedBackup) {
                this.dbLogger.info('Configuration specified migrations may be executed if automated backup is successful. Trying backup now...');
                try {
                    await this.backupDatabase();
                    continueBCBackedup = true;
                } catch (err) {
                    // @ts-ignore
                    this.dbLogger.error(err, {leaf: 'Backup'});
                }
            } else {
                this.dbLogger.info('Configuration DID NOT specify migrations may be executed if automated backup is successful. Will not try to create a backup.');
            }

            if (continueBCBackedup) {
                this.dbLogger.info('Automated backup was successful!');
                await this.doMigration();
                return [true];
            } else {
                if (!force) {
                    this.dbLogger.error(`You must confirm migrations. Either set 'force: true' in database config or confirm migrations from web interface.
YOU SHOULD BACKUP YOUR EXISTING DATABASE BEFORE CONTINUING WITH MIGRATIONS.`);
                    return [false, 'pending'];
                } else {
                    this.dbLogger.info('Migration was forced');
                }
                await this.doMigration();
                return [true];
            }
        } else {
            this.dbLogger.info('No migrations required!');
            return [true];
        }
    }

    async doMigration() {
        this.dbLogger.info('Beginning migrations...');
        await this.database.runMigrations();
    }

    async backupDatabase() {
        // @ts-ignore
        if (this.database.options.type === 'sqljs' && this.database.options.location !== undefined) {
            try {
                const ts = Date.now();
                const backupLocation = `${this.database.options.location}.${ts}.bak`
                this.dbLogger.info(`Detected sqljs (sqlite) database. Will try to make a backup at ${backupLocation}`, {leaf: 'Backup'});
                await copyFile(this.database.options.location, backupLocation, constants.COPYFILE_EXCL);
                this.dbLogger.info('Successfully created backup!', {leaf: 'Backup'});
            } catch (err: any) {
                throw new ErrorWithCause('Cannot make an automated backup of your configured database.', {cause: err});
            }
        } else {
            let msg = 'Cannot make an automated backup of your configured database.';
            if (this.database.options.type !== 'sqljs') {
                msg += ' Only SQlite (sqljs database type) is implemented for automated backups right now, sorry :( You will need to manually backup your database.';
            } else {
                // TODO don't throw for this??
                msg += ' Database location is not defined (probably in-memory).';
            }
            throw new Error(msg);
        }
    }
}
