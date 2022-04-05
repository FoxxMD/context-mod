import {MigrationInterface, QueryRunner, Table, TableIndex, TableColumn, TableForeignKey} from "typeorm";

const randomIdColumn = () => ({
    name: 'id',
    type: 'varchar',
    length: '20',
    isPrimary: true,
    isUnique: true,
});

const timeAtColumn = (columnName: string, dbType: string, nullable?: boolean) => {
    const dbSpecifics = dbType === 'postgres' ? {
        type: 'timestamptz'
    } : {
        type: 'datetime',
        // required to get millisecond precision on mysql/mariadb
        // https://mariadb.com/kb/en/datetime/
        // https://dev.mysql.com/doc/refman/8.0/en/fractional-seconds.html
        length: '3',
    }
    return {
        name: columnName,
        isNullable: nullable ?? false,
        ...dbSpecifics
    }
}

const createdAtColumn = (type: string) => timeAtColumn('createdAt', type);
const updatedAtColumn = (type: string) => timeAtColumn('updatedAt', type);

const createdUpdatedAtColumns = (type: string) => [
    timeAtColumn('createdAt', type),
    timeAtColumn('updatedAt', type)
];


const createdAtIndex = (prefix: string) => new TableIndex({
    name: `IDX_${prefix}_createdAt`,
    columnNames: ['createdAt']
});

const updatedAtIndex = (prefix: string) => new TableIndex({
    name: `IDX_${prefix}_updatedAt`,
    columnNames: ['updatedAt']
})

const createdUpdatedAtIndices = (prefix: string) => {
    return [
        createdAtIndex(prefix),
        updatedAtIndex(prefix)
    ]
}

const filterColumn = (name: string) => ({
    name,
    type: 'varchar',
    length: '20',
    isNullable: true
});

const authorIsColumn = () => filterColumn('authorIs');
const itemIsColumn = () => filterColumn('itemIs');

const filterColumns = () => ([authorIsColumn(), itemIsColumn()]);

const authorIsIndex = (prefix: string) => new TableIndex({
    name: `IDX_${prefix}_authorIs`,
    columnNames: ['authorIs'],
    isUnique: true,
});

const itemIsIndex = (prefix: string) => new TableIndex({
    name: `IDX_${prefix}_itemIs`,
    columnNames: ['itemIs'],
    isUnique: true
});

const filterIndices = (prefix: string) => {
    return [
        authorIsIndex(prefix),
        itemIsIndex(prefix)
    ]
}

export class initWeb1642180264564 implements MigrationInterface {
    name = 'initWeb1642180264564'

    public async up(queryRunner: QueryRunner): Promise<void> {

        const dbType = queryRunner.connection.driver.options.type;

        await queryRunner.createTable(
            new Table({
                name: 'WebSetting',
                columns: [
                    {
                        name: 'name',
                        type: 'varchar',
                        length: '255',
                        isNullable: false,
                    },
                    {
                        name: 'value',
                        type: 'varchar',
                        length: '255',
                        isNullable: false,
                    }
                ],
            }),
            true,
            true,
            true
        );

        await queryRunner.createTable(
            new Table({
                name: 'ClientSession',
                columns: [
                    {
                        name: 'id',
                        type: 'varchar',
                        length: '255',
                        isNullable: false,
                    },
                    {
                        name: 'json',
                        type: 'text'
                    },
                    {
                        name: 'expiredAt',
                        type: 'bigint'
                    },
                    timeAtColumn('destroyedAt', dbType, true)
                ],
                indices: [
                    new TableIndex({
                        name: 'IDX_Session_expired',
                        columnNames: ['expiredAt']
                    }),
                ]
            }),
            true,
            true,
            true
        );

        await queryRunner.createTable(
            new Table({
                name: 'Invite',
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
                    createdAtColumn(dbType),
                    timeAtColumn('expiresAt', dbType, true)
                ],
            }),
            true,
            true,
            true
        );
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
    }

}
