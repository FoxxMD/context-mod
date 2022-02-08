import {Cache} from 'cache-manager';
import {Logger} from "winston";
import {mergeArr} from "../../util";
import * as migrate from 'migrate';
import path from "path";
import {ErrorWithCause} from "pony-cause";

export const cacheMigrationStorage = (client: Cache, resourceLogger: Logger) => {
    const logger = resourceLogger.child({leaf: 'Cache Migration'}, mergeArr);

    return {
        load: async function (fn: any) {

            const migrationData = await client.get('migrations');

            if (migrationData === null || migrationData === undefined) {
                logger.debug('No migration data exists (normal if cache is memory or first-run with anything else)');
                return fn(null, {})
            }
            fn(null, migrationData);
        },

        save: async function (set: any, fn: any) {

            await client.set('migrations', {lastRun: set.lastRun, migrations: set.migrations}, {ttl: 0});
            fn()
        }
    };
}

// with the context stuff use it like this
// migrate.load({
//     stateStore: cacheMigrationStorage(client, logger)
// }, (err, set) => {
//     set.migrate('up', null, (err) => {
//
//     }, {client, subreddit });
// });

export const migrationDir = path.resolve(__dirname, 'Cache');

export const runMigrations = async (cache: Cache, logger: Logger, prefix?: string) => {
    const stateStore = cacheMigrationStorage(cache, logger);
    const context = {client: cache, prefix};
    return new Promise<void>((resolve, reject) => {
        migrate.load({
            migrationsDirectory: migrationDir,
            stateStore,
            filterFunction: (file) => {
                return file.substring(file.length - 3) === '.js';
            },
        }, (err, set) => {
            set.on('migration', function (migration, direction) {
                logger.debug(`${direction}: ${migration.title}`, {leaf: 'Cache Migration'});
            });
            set.migrate('up', null, (err) => {
                if (err) {
                    const migError = new ErrorWithCause('Failed to complete cache migrations', {cause: err});
                    logger.error(migError);
                    reject(err);
                } else {
                    logger.debug('Migrations completed', {leaf: 'Cache Migration'});
                    resolve();
                }
                // @ts-ignore
            }, context);
        });
    })
}
