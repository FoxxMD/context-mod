import {MigrationInterface, QueryRunner, Table, TableColumn} from "typeorm"

export class subredditInvite1663001719622 implements MigrationInterface {

    public async up(queryRunner: QueryRunner): Promise<void> {
        const table = await queryRunner.getTable('SubredditInvite') as Table;

        await queryRunner.addColumns(table, [
            new TableColumn(                    {
                name: 'messageId',
                type: 'varchar',
                length: '200',
                isUnique: true,
                isNullable: true
            }),
        ]);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
    }

}
