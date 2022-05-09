import {Logger} from "winston";
import {DataSource, Table} from "typeorm";
import {intersect, mergeArr} from "../util";
import {DatabaseMigrationOptions} from "./interfaces";
import {copyFile} from "fs/promises";
import {constants} from "fs";
import {ErrorWithCause} from "pony-cause";

export interface ExistingTable {
    table: Table
    name: string
}

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
        this.dbLogger = data.logger.child({labels: [(data.type === 'app' ? 'App' : 'Web'), `Database`, 'Migration']}, mergeArr);
        this.database = data.database;
        this.options = data.options;
    }

    /**
     * Return clean list of names of tables existing only in relevant database/schema
     *
     * @deprecationMessage EntityMetadata.tablePath should return correct name
     * */
    protected async getRelevantExistingTables(): Promise<ExistingTable[]> {
        const runner = this.database.createQueryRunner();
        let existingTables = await runner.getTables();

        const {
            options: {
                type: dbType
            },
            schema,
            database
        } = this.database.driver;

        if (database !== undefined && ['mysql', 'mariadb', 'postgres'].includes(dbType)) {
            // filter by database if it was specified in connection options
            existingTables = existingTables.filter(x => x.database === undefined || x.database === database);
        }

        // Table name from postgres db are prefixed by schema EX: cm.ClientSession
        // need to filter to only used schema tables and then return only non-prefixed table names
        if (dbType === 'postgres') {
            // determine what schema is actually used. Default if not defined is 'public'
            // https://typeorm.io/data-source-options#postgres--cockroachdb-data-source-options
            const realSchema = schema ?? 'public';
            existingTables = existingTables.filter(x => x.schema === realSchema);

            // finally, return table names without schema prefix
            return existingTables.map(x => {
                const splitName = x.name.split('.');
                return {
                    table: x,
                    name: splitName[splitName.length - 1]
                }
            });
        }

        return existingTables.map(x => ({table: x, name: x.name}));
    }

    async initDatabase(): Promise<[boolean, string?]> {
        const {
            force = false,
            continueOnAutomatedBackup = false
        } = this.options || {};

        this.dbLogger.info('Checking if migrations are required...');

        const migrationTableName = this.database.options.migrationsTableName ?? 'migrations';

        const runner = this.database.createQueryRunner();
        const existingTables = await runner.getTables();
        const existingTableNames = existingTables.map(x => x.name);
        // const existingTables = await this.getRelevantExistingTables();
        const potentialTables = this.database.entityMetadatas.map(x => x.tablePath);

        const noTables = existingTables.length === 0;
        const migrationsTablePresent = existingTableNames.some(x => x.includes(migrationTableName));
        const onlyMigrationsTablePresent = existingTables.length === 1 && migrationsTablePresent;
        const blankDb = noTables || onlyMigrationsTablePresent;
        const conflictingTables = intersect(existingTableNames, potentialTables);

        if (blankDb || conflictingTables.length === 0) {
            if(blankDb) {
                this.dbLogger.info('Detected a new database with no domain tables!');
            } else {
                this.dbLogger.info('Database has existing tables/schema (may be system tables) but none conflict with potential domain tables!');
            }
            await this.database.showMigrations();
            await this.doMigration();
            return [true];
        }

        if (!migrationsTablePresent && !force) {
            this.dbLogger.warn(`DANGER! Your database has existing tables but none of them include a '${migrationTableName}' table. 
            Are you sure this is the correct database? Continuing with migrations will most likely drop any existing data and recreate all domain tables.`);
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
        try {
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
        } catch (e: any) {
            this.dbLogger.error(e, {leaf: 'Backup'});
            throw e;
        }
    }
}
