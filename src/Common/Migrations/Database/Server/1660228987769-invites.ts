import {MigrationInterface, QueryRunner, Table, TableColumn} from "typeorm"
import {createdAtColumn, createdAtIndex, idIndex, index, randomIdColumn, tableHasData, timeAtColumn} from "../MigrationUtil";

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

        if (await queryRunner.hasTable('Invite')) {

            await queryRunner.renameTable('Invite', 'BotInvite');
            const table = await queryRunner.getTable('BotInvite') as Table;

            await queryRunner.addColumns(table, [
                new TableColumn({
                    name: 'initialConfig',
                    type: 'text',
                    isNullable: true
                }),
                new TableColumn({
                    name: 'guests',
                    type: 'text',
                    isNullable: true
                })
            ]);

            queryRunner.connection.logger.logSchemaBuild(`Table 'Invite' has been renamed 'BotInvite'. If there are existing rows on this table they will need to be recreated.`);

        } else {

            await queryRunner.createTable(
                new Table({
                    name: 'BotInvite',
                    columns: [
                        {
                            name: 'id',
                            type: 'varchar',
                            length: '255',
                            isPrimary: true,
                        },
                        {
                            name: 'clientId',
                            type: 'varchar',
                            length: '255',
                        },
                        {
                            name: 'clientSecret',
                            type: 'varchar',
                            length: '255',
                        },
                        {
                            name: 'redirectUri',
                            type: 'text',
                        },
                        {
                            name: 'creator',
                            type: 'varchar',
                            length: '255',
                        },
                        {
                            name: 'permissions',
                            type: 'text'
                        },
                        {
                            name: 'instance',
                            type: 'varchar',
                            length: '255',
                            isNullable: true
                        },
                        {
                            name: 'overwrite',
                            type: 'boolean',
                            isNullable: true,
                        },
                        {
                            name: 'subreddits',
                            type: 'text',
                            isNullable: true
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
        }
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
    }

}
