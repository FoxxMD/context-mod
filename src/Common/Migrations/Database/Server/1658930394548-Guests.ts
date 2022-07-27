import {MigrationInterface, QueryRunner, Table} from "typeorm"
import {createdAtColumn, createdAtIndex, idIndex, index, randomIdColumn, timeAtColumn} from "../MigrationUtil";

export class Guests1658930394548 implements MigrationInterface {

    public async up(queryRunner: QueryRunner): Promise<void> {
        const dbType = queryRunner.connection.driver.options.type;

        await queryRunner.createTable(
            new Table({
                name: 'Guests',
                columns: [
                    randomIdColumn(),
                    {
                        name: 'authorName',
                        type: 'varchar',
                        length: '200',
                        isNullable: false,
                    },
                    {
                        name: 'type',
                        type: 'varchar',
                        isNullable: false,
                        length: '50'
                    },
                    {
                        name: 'guestOfId',
                        type: 'varchar',
                        length: '20',
                        isNullable: false
                    },
                    timeAtColumn('expiresAt', dbType, true),
                    createdAtColumn(dbType),
                ],
                indices: [
                    idIndex('Guests', true),
                    createdAtIndex('guests'),
                    index('guest', ['expiresAt'], false)
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
