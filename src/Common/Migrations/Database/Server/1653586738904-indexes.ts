import {MigrationInterface, QueryRunner, Table, TableIndex} from "typeorm"

const index = (prefix: string, columns: string[], unique = true) => new TableIndex({
    name: `IDX_${unique ? 'UN_' : ''}${prefix}_${columns.join('-')}_MIG`,
    columnNames: columns,
    isUnique: unique,
});

const idIndex = (prefix: string, unique: boolean) => index(prefix, ['id'], unique);

export class indexes1653586738904 implements MigrationInterface {

    public async up(queryRunner: QueryRunner): Promise<void> {

        queryRunner.connection.logger.logSchemaBuild('Starting Index Add/Update Migration');
        queryRunner.connection.logger.logSchemaBuild('IF YOU HAVE A LARGE DATABASE THIS MAY TAKE SEVERAL MINUTES! DO NOT STOP CONTEXTMOD WHILE MIGRATION IS IN PROGRESS!');

        // unique ids due to random id
        const uniqueIdTableNames = [
            'Manager',
            'CMEvent',
            'FilterResult',
            'FilterCriteriaResult',
            'RunnableResult',
            'RulePremise',
            'RuleResult',
            'RuleSetResult',
            'ActionPremise',
            'ActionResult',
            'CheckResult',
            'RunResult'
        ];

        for (const tableName of uniqueIdTableNames) {
            const cmTable = await queryRunner.getTable(tableName);
            await queryRunner.createIndex(cmTable as Table, idIndex(tableName, true));
        }

        // additional indexes

        const actSource = await queryRunner.getTable('ActivitySource');
        await queryRunner.createIndex(actSource as Table, idIndex('ActivitySource', false));

        const event = await queryRunner.getTable('CMEvent');
        await queryRunner.createIndices(event as Table, [index('CMEvent', ['activity_id'], false)]);

        // FilterCriteriaResult criteriaId filterResultId

        const fcrTable = await queryRunner.getTable('FilterCriteriaResult');
        await queryRunner.createIndices(fcrTable as Table, [
            index('FilterCriteriaResult', ['criteriaId'], false),
            index('FilterCriteriaResult', ['filterResultId'], false)
        ]);


        // FilterCriteria id

        const fcTable = await queryRunner.getTable('FilterCriteria');
        await queryRunner.createIndices(fcTable as Table, [
            idIndex('FilterCriteriaResult', false),
        ]);

        // RunnableResult resultId runnableId

        const rrTable = await queryRunner.getTable('RunnableResult');
        await queryRunner.createIndices(rrTable as Table, [
            index('RunnableResult', ['resultId'], false),
            index('RunnableResult', ['runnableId'], false)
        ]);

        // ActionResult checkResultId premiseId

        const arTable = await queryRunner.getTable('ActionResult');
        await queryRunner.createIndices(arTable as Table, [
            index('ActionResult', ['checkResultId'], false),
            index('ActionResult', ['premiseId'], false)
        ]);

        // CheckResult runId

        const crTable = await queryRunner.getTable('CheckResult');
        await queryRunner.createIndices(crTable as Table, [
            index('CheckResult', ['runId'], false),
        ]);

        // RunResult eventId

        const runResTable = await queryRunner.getTable('RunResult');
        await queryRunner.createIndices(runResTable as Table, [
            index('RunResult', ['eventId'], false),
        ]);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
    }

}
