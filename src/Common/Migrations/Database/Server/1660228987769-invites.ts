import {MigrationInterface, QueryRunner, Table, TableColumn} from "typeorm"
import {createdAtColumn, createdAtIndex, idIndex, index, randomIdColumn, timeAtColumn} from "../MigrationUtil";

export class invites1660228987769 implements MigrationInterface {

    public async up(queryRunner: QueryRunner): Promise<void> {
        const dbType = queryRunner.connection.driver.options.type;

        await queryRunner.createTable(
            new Table({
                name: 'SubredditInvite',
                columns: [
                    {
                        name: 'id',
                        type: 'varchar',
                        length: '255',
                        isPrimary: true,
                    },
                    {
                        name: 'botId',
                        type: 'varchar',
                        length: '20',
                        isNullable: false
                    },
                    {
                        name: 'subreddit',
                        type: 'varchar',
                        length: '255',
                        isNullable: false
                    },
                    {
                        name: 'guests',
                        type: 'text',
                        isNullable: true
                    },
                    {
                        name: 'initialConfig',
                        type: 'text',
                        isNullable: true
                    },
                    createdAtColumn(dbType),
                    timeAtColumn('expiresAt', dbType, true)
                ],
            }),
            true,
            true,
            true
        );

        await queryRunner.renameTable('Invite', 'BotInvite');
        const table = await queryRunner.getTable('BotInvite') as Table;
        table.addColumn(new TableColumn({
            name: 'initialConfig',
            type: 'text',
            isNullable: true
        }));
        table.addColumn(new TableColumn({
            name: 'guests',
            type: 'text',
            isNullable: true
        }));
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
    }

}
