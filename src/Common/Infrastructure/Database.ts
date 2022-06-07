import {LoggerOptions} from "typeorm/logger/LoggerOptions";
import {SqljsConnectionOptions} from "typeorm/driver/sqljs/SqljsConnectionOptions";
import {MysqlConnectionOptions} from "typeorm/driver/mysql/MysqlConnectionOptions";
import {PostgresConnectionOptions} from "typeorm/driver/postgres/PostgresConnectionOptions";
import {BetterSqlite3ConnectionOptions} from "typeorm/driver/better-sqlite3/BetterSqlite3ConnectionOptions";

export type DatabaseDriverType = 'sqljs' | 'better-sqlite3' | 'mysql' | 'mariadb' | 'postgres';
export type DatabaseConfig =
    SqljsConnectionOptions
    | MysqlConnectionOptions
    | PostgresConnectionOptions
    | BetterSqlite3ConnectionOptions;
export type DatabaseDriverConfig = {
    type: DatabaseDriverType,
    [key: string]: any
    /**
     * Set the type of logging typeorm should output
     *
     * Defaults to errors, warnings, and schema (migration progress)
     * */
    logging?: LoggerOptions
}
export type DatabaseDriver = DatabaseDriverType | DatabaseDriverConfig;
