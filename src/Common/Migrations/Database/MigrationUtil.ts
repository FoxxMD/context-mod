import {QueryRunner, TableIndex} from "typeorm";

/**
 * Boilerplate for creating generic index
 * */
export const index = (prefix: string, columns: string[], unique = true) => new TableIndex({
    name: `IDX_${unique ? 'UN_' : ''}${prefix}_${columns.join('-')}`,
    columnNames: columns,
    isUnique: unique,
});
/**
 * Create index on id column
 * */
export const idIndex = (prefix: string, unique: boolean) => index(prefix, ['id'], unique);

/**
 * Boilerplate primary key column for random ID
 * */
export const randomIdColumn = () => ({
    name: 'id',
    type: 'varchar',
    length: '20',
    isPrimary: true,
    isUnique: true,
});

/**
 * Create a time data column based on database type
 * */
export const timeAtColumn = (columnName: string, dbType: string, nullable?: boolean) => {
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
export const createdAtColumn = (type: string) => timeAtColumn('createdAt', type);
const updatedAtColumn = (type: string) => timeAtColumn('updatedAt', type);
const createdUpdatedAtColumns = (type: string) => [
    timeAtColumn('createdAt', type),
    timeAtColumn('updatedAt', type)
];
export const createdAtIndex = (prefix: string) => index(prefix, ['createdAt'], false);

const updatedAtIndex = (prefix: string) => index(prefix, ['updatedAt'], false);
const createdUpdatedAtIndices = (prefix: string) => {
    return [
        createdAtIndex(prefix),
        updatedAtIndex(prefix)
    ]
}
/**
 * Boilerplate for filter (itemIs, authorIs) FK column -- uses FK is filter ID
 * */
const filterColumn = (name: string) => ({
    name,
    type: 'varchar',
    length: '20',
    isNullable: true
});
const authorIsColumn = () => filterColumn('authorIs');
const itemIsColumn = () => filterColumn('itemIs');
export const filterColumns = () => ([authorIsColumn(), itemIsColumn()]);
const authorIsIndex = (prefix: string) => index(prefix, ['authorIs']);
const itemIsIndex = (prefix: string) => index(prefix, ['itemIs']);
export const filterIndices = (prefix: string) => {
    return [
        authorIsIndex(prefix),
        itemIsIndex(prefix)
    ]
}

export const tableHasData = async (runner: QueryRunner, name: string): Promise<boolean | null> => {
    const countRes = await runner.query(`select count(*) from ${name}`);
    let hasRows = null;
    if (Array.isArray(countRes) && countRes[0] !== null) {
        const {
            'count(*)': count
        } = countRes[0] || {};
        hasRows = count !== 0;
    }
    return hasRows;
}
