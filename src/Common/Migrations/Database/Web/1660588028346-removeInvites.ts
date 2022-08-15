import {MigrationInterface, QueryRunner} from "typeorm"
import {tableHasData} from "../MigrationUtil";

export class removeInvites1660588028346 implements MigrationInterface {

    public async up(queryRunner: QueryRunner): Promise<void> {
        const dbType = queryRunner.connection.driver.options.type;

        if (dbType === 'sqljs' && await queryRunner.hasTable('Invite')) {
            // const countRes = await queryRunner.query('select count(*) from Invite');
            // let hasNoRows = null;
            // if (Array.isArray(countRes) && countRes[0] !== null) {
            //     const {
            //         'count(*)': count
            //     } = countRes[0] || {};
            //     hasNoRows = count === 0;
            // }

            const hasRows = await tableHasData(queryRunner, 'Invite');

            if (hasRows === false) {
                await queryRunner.dropTable('Invite');
            } else {
                let prefix = hasRows === null ? `Could not determine if SQL.js 'web' database had the table 'Invite' --` : `SQL.js 'web' database had the table 'Invite' and it is not empty --`
                queryRunner.connection.logger.logSchemaBuild(`${prefix} This table is being replaced by 'BotInvite' table in 'app' database. If you have existing invites you will need to recreate them.`);
            }
        }
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
    }

}
