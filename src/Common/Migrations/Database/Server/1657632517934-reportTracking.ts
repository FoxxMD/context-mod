import {MigrationInterface, QueryRunner, Table, TableIndex} from "typeorm"
import {createdAtColumn, createdAtIndex, idIndex, index, randomIdColumn} from "../MigrationUtil";

export class reportTracking1657632517934 implements MigrationInterface {

    public async up(queryRunner: QueryRunner): Promise<void> {

        const dbType = queryRunner.connection.driver.options.type;

        await queryRunner.createTable(
            new Table({
                name: 'ActivityReport',
                columns: [
                    randomIdColumn(),
                    {
                        name: 'activityId',
                        type: 'varchar',
                        length: '20',
                        isNullable: false
                    },
                    {
                        name: 'reason',
                        type: 'varchar',
                        length: '500',
                        isNullable: false
                    },
                    {
                        name: 'type',
                        type: 'varchar',
                        length: '200',
                        isNullable: false
                    },
                    {
                        name: 'author',
                        type: 'varchar',
                        length: '100',
                        isNullable: true
                    },
                    {
                        name: 'granularity',
                        type: 'int',
                        isNullable: false
                    },
                    createdAtColumn(dbType),
                ],
                indices: [
                    idIndex('ActivityReport', true),
                    index('ActivityReport', ['activityId'], false),
                    index('ActivityReportReason', ['reason'], false),
                    createdAtIndex('report'),
                ]
            }),
            true,
            true,
            true
        );
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
    }

}
