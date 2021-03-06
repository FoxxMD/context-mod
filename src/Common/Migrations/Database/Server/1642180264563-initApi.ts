import {MigrationInterface, QueryRunner, Table, TableIndex} from "typeorm";
import {
    createdAtColumn,
    createdAtIndex,
    filterColumns,
    filterIndices,
    randomIdColumn,
    timeAtColumn
} from "../MigrationUtil";

export class initApi1642180264563 implements MigrationInterface {
    name = 'initApi1642180264563'

    public async up(queryRunner: QueryRunner): Promise<void> {

        const dbType = queryRunner.connection.driver.options.type;

/*        await queryRunner.createTable(
            new Table({
                name: 'InstanceSetting',
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
        );*/




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
                        name: 'author',
                        type: 'varchar',
                        length: '150',
                        isNullable: false
                    },
                    {
                        name: 'managerId',
                        type: 'varchar',
                        length: '20',
                        isNullable: false
                    },
                    {
                        name: 'dryRun',
                        type: 'boolean',
                        isNullable: true,
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
                        name: 'name',
                        type: 'varchar',
                        length: '300',
                        isNullable: true
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

        await queryRunner.createTable(
            new Table({
                name: 'RunnableResult',
                columns: [
                    randomIdColumn(),
                    {
                        name: 'type',
                        type: 'varchar',
                        isNullable: false,
                        length: '50'
                    },
                    {
                        name: 'order',
                        type: 'integer',
                        isNullable: false,
                    },
                    {
                        name: 'resultId',
                        type: 'varchar',
                        length: '20',
                        isNullable: false,
                    },
                    {
                        name: 'runnableId',
                        type: 'varchar',
                        length: '20',
                        isNullable: false,
                    },
                    createdAtColumn(dbType),
                ],
                indices: [
                    new TableIndex({
                        name: 'IDX_RunnableResult_type',
                        columnNames: ['type']
                    }),
                    createdAtIndex('RunnableResult'),
                ]
            }),
            true
        );

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
        // await queryRunner.createTable(
        //     new Table({
        //         name: 'Rule',
        //         columns: [
        //             {
        //                 name: 'id',
        //                 type: 'varchar',
        //                 isPrimary: true,
        //                 length: '300'
        //             },
        //             {
        //                 name: 'name',
        //                 type: 'varchar',
        //                 length: '300',
        //                 isNullable: true
        //             },
        //             {
        //                 name: 'kindId',
        //                 type: 'integer',
        //                 isNullable: false
        //             },
        //             {
        //                 name: 'managerId',
        //                 type: 'varchar',
        //                 length: '20',
        //                 isNullable: false
        //             },
        //         ]
        //     }),
        //     true
        // );

        await queryRunner.createTable(
            new Table({
                name: 'RulePremise',
                columns: [
                    randomIdColumn(),
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
                    {
                        name: 'active',
                        type: 'boolean',
                        isNullable: false,
                    },
                    {
                        name: 'configHash',
                        type: 'varchar',
                        length: '300',
                        isNullable: false
                    },
                    {
                        name: 'config',
                        type: 'text',
                        isNullable: false
                    },
                    {
                        name: 'itemIsConfigHash',
                        type: 'varchar',
                        length: '300',
                        isNullable: true
                    },
                    {
                        name: 'itemIsConfig',
                        type: 'text',
                        isNullable: true
                    },
                    {
                        name: 'authorIsConfigHash',
                        type: 'varchar',
                        length: '300',
                        isNullable: true
                    },
                    {
                        name: 'authorIsConfig',
                        type: 'text',
                        isNullable: true
                    },
                    createdAtColumn(dbType)
                ],
                indices: [
                    createdAtIndex('RulePremise'),
                    new TableIndex({
                        name: `IDX_rulePremise_unique`,
                        columnNames: ['name', 'kindId', 'managerId', 'configHash', 'authorIsConfigHash', 'itemIsConfigHash'],
                        isUnique: true
                    })
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
                        name: 'premiseId',
                        type: 'varchar',
                        length: '20',
                        isNullable: false
                    },
                    // {
                    //     name: 'checkResultId',
                    //     type: 'varchar',
                    //     length: '20',
                    //     isNullable: false
                    // },
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

        await queryRunner.createTable(
            new Table({
                name: 'RuleSetResult',
                columns: [
                    randomIdColumn(),
                    {
                        name: 'condition',
                        type: 'varchar',
                        length: '20',
                        isNullable: false
                    },
                    createdAtColumn(dbType),
                    {
                        name: 'triggered',
                        type: 'boolean',
                        isNullable: true,
                    },
                ],
                indices: [
                    createdAtIndex('RuleSetResult'),
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
        // await queryRunner.createTable(
        //     new Table({
        //         name: 'Action',
        //         columns: [
        //
        //         ]
        //     }),
        //     true
        // );

        await queryRunner.createTable(
            new Table({
                name: 'ActionPremise',
                columns: [
                    randomIdColumn(),
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
                    {
                        name: 'active',
                        type: 'boolean',
                        isNullable: false,
                    },
                    {
                        name: 'configHash',
                        type: 'varchar',
                        length: '300',
                        isNullable: false
                    },
                    {
                        name: 'config',
                        type: 'text',
                        isNullable: false
                    },
                    {
                        name: 'itemIsConfigHash',
                        type: 'varchar',
                        length: '300',
                        isNullable: true
                    },
                    {
                        name: 'itemIsConfig',
                        type: 'text',
                        isNullable: true
                    },
                    {
                        name: 'authorIsConfigHash',
                        type: 'varchar',
                        length: '300',
                        isNullable: true
                    },
                    {
                        name: 'authorIsConfig',
                        type: 'text',
                        isNullable: true
                    },
                    createdAtColumn(dbType)
                ],
                indices: [
                    createdAtIndex('ActionPremise'),
                    new TableIndex({
                        name: `IDX_actionPremise_unique`,
                        columnNames: ['name', 'kindId', 'managerId', 'configHash', 'authorIsConfigHash', 'itemIsConfigHash'],
                        isUnique: true
                    })
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
                        name: 'premiseId',
                        type: 'varchar',
                        length: '20',
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
                        name: 'recordOutputs',
                        type: 'text',
                        isNullable: true
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
