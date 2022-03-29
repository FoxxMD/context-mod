import {MigrationInterface, QueryRunner, Table, TableIndex, TableColumn, TableForeignKey} from "typeorm";

const randomIdColumn = () => ({
    name: 'id',
    type: 'varchar',
    length: '20',
    isPrimary: true,
    isUnique: true,
});

const timeAtColumn = (columnName: string, dbType: string) => {
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
        isNullable: false,
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

export class initApi1642180264563 implements MigrationInterface {
    name = 'initApi1642180264563'

    public async up(queryRunner: QueryRunner): Promise<void> {

        const dbType = queryRunner.connection.driver.options.type;

        await queryRunner.createTable(
            new Table({
                name: 'Author',
                columns: [
                    {
                        name: 'id',
                        type: 'varchar',
                        length: '20',
                        isNullable: true,
                        isUnique: true,
                    },
                    {
                        name: 'name',
                        type: 'varchar',
                        length: '200',
                        isPrimary: true,
                        isUnique: true,
                    }
                ],
                indices: [
                    new TableIndex({
                        name: 'IDX_Author_name',
                        columnNames: ['name']
                    }),
                    new TableIndex({
                        name: 'IDX_Author_id',
                        columnNames: ['id']
                    })
                ]
            }),
            true,
            true,
            true
        );

        await queryRunner.createTable(
            new Table({
                name: 'Bot',
                columns: [
                    randomIdColumn(),
                    {
                        name: 'name',
                        type: 'varchar',
                        length: '200',
                        isNullable: false
                    }
                ]
            }),
            true
        );

        await queryRunner.createTable(
            new Table({
                name: 'Subreddit',
                columns: [
                    {
                        name: 'id',
                        type: 'varchar',
                        isPrimary: true,
                        length: '20'
                    },
                    {
                        name: 'name',
                        type: 'varchar',
                        length: '200',
                        isNullable: false
                    }
                ]
            }),
            true
        );

        await queryRunner.createTable(
            new Table({
                name: 'InvokeeType',
                columns: [
                    {
                        name: 'id',
                        type: 'integer',
                        isPrimary: true,
                        generationStrategy: 'increment',
                        isGenerated: true
                    },
                    {
                        name: 'name',
                        type: 'varchar',
                        length: '50'
                    }
                ]
            }),
            true
        );

        await queryRunner.createTable(
            new Table({
                name: 'RunStateType',
                columns: [
                    {
                        name: 'id',
                        type: 'integer',
                        isPrimary: true,
                        generationStrategy: 'increment',
                        isGenerated: true
                    },
                    {
                        name: 'name',
                        type: 'varchar',
                        length: '50'
                    }
                ]
            }),
            true
        );

        await queryRunner.createTable(
            new Table({
                name: 'EntityRunState',
                columns: [
                    {
                        name: 'id',
                        type: 'integer',
                        isPrimary: true,
                        generationStrategy: 'increment',
                        isGenerated: true
                    },
                    {
                        name: 'type',
                        type: 'varchar',
                        length: '50'
                    },
                    {
                        name: 'invokeeId',
                        type: 'integer',
                        isNullable: false,
                    },
                    {
                        name: 'runTypeId',
                        type: 'integer',
                        isNullable: false,
                    },
                ],
                indices: [
                    new TableIndex({
                        name: 'IDX_EntityStateType_type',
                        columnNames: ['type']
                    })
                ]
            }),
            true,
            true,
            true
        );

        await queryRunner.createTable(
            new Table({
                name: 'Activity',
                columns: [
                    {
                        name: 'id',
                        type: 'varchar',
                        isPrimary: true,
                        length: '20'
                    },
                    {
                        name: 'name',
                        type: 'varchar',
                        length: '20',
                        isNullable: false
                    },
                    {
                        name: 'type',
                        type: 'varchar',
                        length: '20',
                        isNullable: false
                    },
                    {
                        name: 'content',
                        type: 'text',
                        isNullable: false,
                    },
                    {
                        name: 'permalink',
                        type: 'varchar',
                        length: '240',
                        isNullable: false,
                    },
                    {
                        name: 'subredditId',
                        type: 'varchar',
                        length: '20',
                        isNullable: true,
                    },
                    {
                        name: 'authorName',
                        type: 'varchar',
                        length: '200',
                        isNullable: false,
                    },
                    {
                        name: 'submission_id',
                        type: 'varchar',
                        length: '20',
                        isNullable: true,
                    },
                ],
                indices: [
                    new TableIndex({
                        name: 'IDX_Activity_permalink',
                        columnNames: ['permalink']
                    }),
                    new TableIndex({
                        name: 'IDX_Activity_nameType',
                        columnNames: ['type', 'name']
                    })
                ]
            }),
            true,
            true,
            true
        );

        await queryRunner.createTable(
            new Table({
                name: 'Manager',
                columns: [
                    randomIdColumn(),
                    {
                        name: 'name',
                        type: 'varchar',
                        length: '200',
                        isNullable: false
                    },
                    {
                        name: 'botId',
                        type: 'varchar',
                        length: '20',
                        isNullable: false
                    },
                    {
                        name: 'subredditId',
                        type: 'varchar',
                        length: '20',
                        isNullable: false
                    },
                    {
                        name: 'eventsStateId',
                        type: 'integer',
                        isNullable: true,
                        isUnique: true
                    },
                    {
                        name: 'queueStateId',
                        type: 'integer',
                        isNullable: true,
                        isUnique: true,
                    },
                    {
                        name: 'managerStateId',
                        type: 'integer',
                        isNullable: true,
                        isUnique: true
                    },
                ]
            }),
            true,
            true,
            true
        );

        await queryRunner.createTable(
            new Table({
                name: 'ActivitySource',
                columns: [
                    {
                        name: 'id',
                        type: 'varchar',
                        length: '50',
                        isNullable: false
                    },
                    {
                        name: 'type',
                        type: 'varchar',
                        length: '20',
                        isNullable: false
                    },
                    {
                        name: 'identifier',
                        type: 'varchar',
                        length: '100',
                        isNullable: true
                    },
                    {
                        name: 'action',
                        type: 'varchar',
                        length: '100',
                        isNullable: true,
                    },
                    {
                        name: 'delay',
                        type: 'integer',
                        isNullable: true,
                    },
                    {
                        name: 'goto',
                        type: 'varchar',
                        length: '100',
                        isNullable: true,
                    },
                    {
                        name: 'managerId',
                        type: 'varchar',
                        length: '20',
                        isNullable: false
                    },
                ]
            }),
            true,
            true,
            true
        );

        await queryRunner.createTable(
            new Table({
                name: 'CMEvent',
                columns: [
                    randomIdColumn(),
                    {
                        name: 'triggered',
                        type: 'boolean',
                        isNullable: false
                    },
                    {
                        name: 'activity_id',
                        type: 'varchar',
                        length: '20',
                        isNullable: false
                    },
                    {
                        name: 'sourceId',
                        type: 'varchar',
                        length: '50',
                        isNullable: false
                    },
                    {
                        name: 'managerId',
                        type: 'varchar',
                        length: '20',
                        isNullable: false
                    },
                    timeAtColumn('processedAt', dbType),
                    timeAtColumn('queuedAt', dbType)
                ],
                indices: [
                    new TableIndex({
                        name: `IDX_cmevent_processedAt`,
                        columnNames: ['processedAt']
                    }),
                    new TableIndex({
                        name: `IDX_cmevent_queuedAt`,
                        columnNames: ['queuedAt']
                    })
                ]
            }),
            true,
            true,
            true
        );


        await queryRunner.createTable(
            new Table({
                name: 'DispatchedAction',
                columns: [
                    randomIdColumn(),
                    {
                        name: 'activityId',
                        type: 'varchar',
                        length: '20',
                        isNullable: false
                    },
                    {
                        name: 'managerId',
                        type: 'varchar',
                        length: '20',
                        isNullable: false
                    },
                    {
                        name: 'delay',
                        type: 'integer',
                        isNullable: false,
                    },
                    {
                        name: 'action',
                        type: 'varchar',
                        length: '100',
                        isNullable: true
                    },
                    {
                        name: 'goto',
                        type: 'varchar',
                        length: '200',
                        isNullable: true
                    },
                    {
                        name: 'type',
                        type: 'varchar',
                        length: '100',
                        isNullable: false
                    },
                    {
                        name: 'identifier',
                        type: 'varchar',
                        length: '200',
                        isNullable: true
                    },
                    {
                        name: 'cancelIfQueued',
                        type: 'varchar',
                        length: '100',
                        isNullable: true
                    },
                    {
                        name: 'onExistingFound',
                        type: 'varchar',
                        length: '100',
                        isNullable: true
                    },
                    {
                        name: 'tardyTolerant',
                        type: 'varchar',
                        length: '100',
                        isNullable: false
                    },
                    createdAtColumn(dbType),
                ]
            }),
            true,
            true,
            true
        );

        await queryRunner.createTable(
            new Table({
                name: 'TimeSeriesStat',
                columns: [
                    {
                        name: 'id',
                        type: 'integer',
                        isPrimary: true,
                        generationStrategy: 'increment',
                        isGenerated: true
                    },
                    createdAtColumn(dbType),
                    {
                        name: 'granularity',
                        type: 'varchar',
                        length: '20',
                        isNullable: false
                    },
                    {
                        name: 'metric',
                        type: 'varchar',
                        length: '60',
                        isNullable: false
                    },
                    {
                        name: 'value',
                        type: 'decimal',
                        precision: 12,
                        scale: 2,
                        isNullable: false,
                    },
                    {
                        name: 'managerId',
                        type: 'varchar',
                        length: '20',
                        isNullable: false
                    },
                ],
                indices: [
                    createdAtIndex('timeseries')
                ]
            }),
            true,
            true,
            true
        );

        await queryRunner.createTable(
            new Table({
                name: 'TotalStat',
                columns: [
                    {
                        name: 'id',
                        type: 'integer',
                        isPrimary: true,
                        generationStrategy: 'increment',
                        isGenerated: true
                    },
                    createdAtColumn(dbType),
                    {
                        name: 'metric',
                        type: 'varchar',
                        length: '60',
                        isNullable: false
                    },
                    {
                        name: 'value',
                        type: 'decimal',
                        precision: 12,
                        scale: 2,
                        isNullable: false,
                    },
                    {
                        name: 'managerId',
                        type: 'varchar',
                        length: '20',
                        isNullable: false
                    },
                ],
                indices: [
                    createdAtIndex('total')
                ]
            }),
            true,
            true,
            true
        );

        //<editor-fold desc="Filters (Author/ItemIs)">

        await queryRunner.createTable(
            new Table({
                name: 'FilterResult',
                columns: [
                    randomIdColumn(),
                    {
                        name: 'join',
                        type: 'varchar',
                        isNullable: false,
                        length: '10'
                    },
                    {
                        name: 'passed',
                        type: 'boolean',
                        isNullable: false,
                    },
                    {
                        name: 'type',
                        type: 'varchar',
                        isNullable: false,
                        length: '50'
                    },
                ],
                indices: [
                    new TableIndex({
                        name: 'IDX_FilterResult_type',
                        columnNames: ['type']
                    }),
                ]
            }),
            true
        );

        await queryRunner.createTable(
            new Table({
                name: 'FilterCriteria',
                columns: [
                    {
                        name: 'id',
                        type: 'varchar',
                        length: '300',
                        isPrimary: true,
                    },
                    {
                        name: 'criteria',
                        type: 'text',
                        isNullable: false,
                    },
                    {
                        name: 'hash',
                        type: 'varchar',
                        isNullable: false,
                        length: '150'
                    },
                    {
                        name: 'type',
                        type: 'varchar',
                        isNullable: false,
                        length: '50'
                    },
                ],
                indices: [
                    new TableIndex({
                        name: 'IDX_FilterCriteria_hash',
                        columnNames: ['hash']
                    }),
                ]
            }),
            true
        );

        await queryRunner.createTable(
            new Table({
                name: 'FilterCriteriaResult',
                columns: [
                    randomIdColumn(),
                    {
                        name: 'behavior',
                        type: 'varchar',
                        length: '20',
                        isNullable: false,
                    },
                    {
                        name: 'propertyResults',
                        type: 'text',
                        isNullable: false,
                    },
                    {
                        name: 'passed',
                        type: 'boolean',
                        isNullable: false,
                    },
                    {
                        name: 'type',
                        type: 'varchar',
                        isNullable: false,
                        length: '50'
                    },
                    {
                        name: 'filterResultId',
                        type: 'varchar',
                        isNullable: false,
                        length: '20'
                    },
                    {
                        name: 'criteriaId',
                        type: 'varchar',
                        isNullable: false,
                        length: '300'
                    },
                ],
                indices: [
                    new TableIndex({
                        name: 'IDX_FilterCriteriaResult_type',
                        columnNames: ['type']
                    }),
                ]
            }),
            true,
            true,
            true,
        );

        //</editor-fold>

        //<editor-fold desc="Rule Stuff">

        await queryRunner.createTable(
            new Table({
                name: 'RuleType',
                columns: [
                    {
                        name: 'id',
                        type: 'integer',
                        isPrimary: true,
                        generationStrategy: 'increment',
                        isGenerated: true
                    },
                    {
                        name: 'name',
                        type: 'varchar'
                    }
                ]
            }),
            true
        );
        await queryRunner.createTable(
            new Table({
                name: 'Rule',
                columns: [
                    {
                        name: 'id',
                        type: 'varchar',
                        isPrimary: true,
                        length: '300'
                    },
                    {
                        name: 'name',
                        type: 'varchar',
                        length: '300',
                        isNullable: true
                    },
                    {
                        name: 'kindId',
                        type: 'integer',
                        isNullable: false
                    },
                    {
                        name: 'managerId',
                        type: 'varchar',
                        length: '20',
                        isNullable: false
                    },
                ]
            }),
            true
        );

        await queryRunner.createTable(
            new Table({
                name: 'RulePremise',
                columns: [
                    {
                        name: 'ruleId',
                        type: 'varchar',
                        length: '300',
                        isPrimary: true,
                        //isNullable: false
                    },
                    {
                        name: 'configHash',
                        type: 'varchar',
                        length: '300',
                        isPrimary: true
                        //isNullable: false
                    },
                    {
                        name: 'config',
                        type: 'text',
                        isNullable: false
                    },
                    {
                        name: 'version',
                        type: 'integer',
                        isNullable: false
                    },
                    ...createdUpdatedAtColumns(dbType)
                ],
                indices: [
                    ...createdUpdatedAtIndices('RulePremise')
                ]
            }),
            true,
            true,
            true
        );

        await queryRunner.createTable(
            new Table({
                name: 'RuleResult',
                columns: [
                    randomIdColumn(),
                    {
                        name: 'premiseRuleId',
                        type: 'varchar',
                        isNullable: false
                    },
                    {
                        name: 'premiseConfigHash',
                        type: 'varchar',
                        length: '300',
                        isNullable: false
                    },
                    {
                        name: 'checkResultId',
                        type: 'varchar',
                        length: '20',
                        isNullable: false
                    },
                    {
                        name: 'data',
                        type: 'text',
                        isNullable: true
                    },
                    createdAtColumn(dbType),
                    {
                        name: 'triggered',
                        type: 'boolean',
                        isNullable: true,
                    },
                    {
                        name: 'fromCache',
                        type: 'boolean',
                        isNullable: true,
                    },
                    {
                        name: 'result',
                        type: 'text',
                        isNullable: true
                    },
                    ...filterColumns(),
                ],
                indices: [
                    createdAtIndex('RuleResult'),
                    ...filterIndices('RuleResult')
                ]
            }),
            true,
            true,
            true
        );

        //</editor-fold>

        //<editor-fold desc="Action Stuff">

        await queryRunner.createTable(
            new Table({
                name: 'ActionType',
                columns: [
                    {
                        name: 'id',
                        type: 'integer',
                        isPrimary: true,
                        generationStrategy: 'increment',
                        isGenerated: true
                    },
                    {
                        name: 'name',
                        type: 'varchar'
                    }
                ]
            }),
            true
        );
        await queryRunner.createTable(
            new Table({
                name: 'Action',
                columns: [
                    {
                        name: 'id',
                        type: 'varchar',
                        isPrimary: true,
                        length: '300'
                    },
                    {
                        name: 'name',
                        type: 'varchar',
                        length: '300',
                        isNullable: true
                    },
                    {
                        name: 'kindId',
                        type: 'integer',
                        isNullable: false
                    },
                    {
                        name: 'managerId',
                        type: 'varchar',
                        length: '20',
                        isNullable: false
                    },
                ]
            }),
            true
        );

        await queryRunner.createTable(
            new Table({
                name: 'ActionPremise',
                columns: [
                    {
                        name: 'actionId',
                        type: 'varchar',
                        length: '300',
                        isPrimary: true,
                        //isNullable: false
                    },
                    {
                        name: 'configHash',
                        type: 'varchar',
                        length: '300',
                        isPrimary: true
                        //isNullable: false
                    },
                    {
                        name: 'config',
                        type: 'text',
                        isNullable: false
                    },
                    {
                        name: 'version',
                        type: 'integer',
                        isNullable: false
                    },
                    ...createdUpdatedAtColumns(dbType)
                ],
                indices: [
                    ...createdUpdatedAtIndices('ActionPremise')
                ]
            }),
            true,
            true,
            true
        );

        await queryRunner.createTable(
            new Table({
                name: 'ActionResult',
                columns: [
                    randomIdColumn(),
                    {
                        name: 'checkResultId',
                        type: 'varchar',
                        length: '20',
                        isNullable: false
                    },
                    {
                        name: 'premiseActionId',
                        type: 'varchar',
                        length: '150',
                        isNullable: false
                    },
                    {
                        name: 'premiseConfigHash',
                        type: 'varchar',
                        length: '150',
                        isNullable: false
                    },
                    {
                        name: 'run',
                        type: 'boolean',
                        isNullable: false,
                    },
                    {
                        name: 'dryRun',
                        type: 'boolean',
                        isNullable: false,
                    },
                    {
                        name: 'success',
                        type: 'boolean',
                        isNullable: false,
                    },
                    {
                        name: 'runReason',
                        type: 'text',
                        isNullable: true,
                    },
                    {
                        name: 'result',
                        type: 'text',
                        isNullable: true,
                    },
                    createdAtColumn(dbType),
                    ...filterColumns(),
                ],
                indices: [
                    createdAtIndex('ActionResult'),
                    ...filterIndices('ActionResult')
                ]
            }),
            true,
            true,
            true
        );

        //</editor-fold>

        //<editor-fold desc="Check Stuff">

        await queryRunner.createTable(
            new Table({
                name: 'Check',
                columns: [
                    {
                        name: 'name',
                        type: 'varchar',
                        isPrimary: true,
                        length: '300'
                    },
                    {
                        name: 'type',
                        type: 'varchar',
                        length: '20',
                        isNullable: false
                    },
                    {
                        name: 'runName',
                        type: 'varchar',
                        length: '300',
                        isNullable: false
                    },
                    {
                        name: 'managerId',
                        type: 'varchar',
                        length: '20',
                        isNullable: false
                    },
                ]
            }),
            true
        );

        await queryRunner.createTable(
            new Table({
                name: 'CheckResult',
                columns: [
                    randomIdColumn(),
                    {
                        name: 'triggered',
                        type: 'boolean',
                        isNullable: false,
                    },
                    {
                        name: 'fromCache',
                        type: 'boolean',
                        isNullable: true
                    },
                    {
                        name: 'condition',
                        type: 'varchar',
                        length: '20',
                        isNullable: false
                    },
                    {
                        name: 'error',
                        type: 'text',
                        isNullable: true,
                    },
                    {
                        name: 'postBehavior',
                        type: 'varchar',
                        length: '50',
                        isNullable: false
                    },
                    {
                        name: 'checkName',
                        type: 'varchar',
                        length: '50',
                        isNullable: false
                    },
                    {
                        name: 'runId',
                        type: 'varchar',
                        length: '20',
                        isNullable: false
                    },
                    createdAtColumn(dbType),
                    ...filterColumns(),
                ],
                indices: [
                    createdAtIndex('CheckResult'),
                    ...filterIndices('CheckResult')
                ]
            }),
            true,
            true,
            true
        );

        //</editor-fold>

        //<editor-fold desc="Run Stuff">

        await queryRunner.createTable(
            new Table({
                name: 'Run',
                columns: [
                    {
                        name: 'name',
                        type: 'varchar',
                        isPrimary: true,
                        length: '300'
                    },
                    {
                        name: 'managerId',
                        type: 'varchar',
                        length: '20',
                        isNullable: false
                    },
                ]
            }),
            true
        );

        await queryRunner.createTable(
            new Table({
                name: 'RunResult',
                columns: [
                    randomIdColumn(),
                    {
                        name: 'triggered',
                        type: 'boolean',
                        isNullable: false,
                    },
                    {
                        name: 'reason',
                        type: 'text',
                        isNullable: true,
                    },
                    {
                        name: 'error',
                        type: 'text',
                        isNullable: true,
                    },
                    {
                        name: 'runName',
                        type: 'varchar',
                        length: '300',
                        isNullable: false
                    },
                    {
                        name: 'eventId',
                        type: 'varchar',
                        length: '20',
                        isNullable: false
                    },
                    createdAtColumn(dbType),
                    ...filterColumns(),
                ],
                indices: [
                    createdAtIndex('RunResult'),
                    ...filterIndices('RunResult')
                ]
            }),
            true,
            true,
            true
        );

        //</editor-fold>
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
    }

}
