import {MigrationInterface, QueryRunner, TableColumn} from "typeorm"

export class delayedReset1667415256831 implements MigrationInterface {

    public async up(queryRunner: QueryRunner): Promise<void> {
        queryRunner.connection.logger.logSchemaBuild('Truncating (removing) existing Dispatched Actions due to internal structural changes');
        await queryRunner.clearTable('DispatchedAction');
        await queryRunner.changeColumn('DispatchedAction', 'author', new TableColumn({
            name: 'author',
            type: 'varchar',
            length: '150',
            isNullable: true
        }));
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
    }

}
