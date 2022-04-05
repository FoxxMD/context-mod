import {MigrationInterface, QueryRunner} from "typeorm";
import {RuleType} from "../../../Entities/RuleType";
import {ActionType} from "../../../Entities/ActionType";
import {InvokeeType} from "../../../Entities/InvokeeType";
import {RunStateType} from "../../../Entities/RunStateType";

export class initialData1642180274563 implements MigrationInterface {

    name = 'initialData1642180274563';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.manager.getRepository(RuleType).save([
            new RuleType('recent'),
            new RuleType('repeat'),
            new RuleType('author'),
            new RuleType('attribution'),
            new RuleType('history'),
            new RuleType('regex'),
            new RuleType('repost')
        ]);
        await queryRunner.manager.getRepository(ActionType).save([
            new ActionType('comment'),
            new ActionType('lock'),
            new ActionType('remove'),
            new ActionType('report'),
            new ActionType('approve'),
            new ActionType('ban'),
            new ActionType('flair'),
            new ActionType('usernote'),
            new ActionType('message'),
            new ActionType('userflair'),
            new ActionType('dispatch'),
            new ActionType('cancelDispatch'),
            new ActionType('contributor'),
        ]);
        await queryRunner.manager.getRepository(InvokeeType).save([
            new InvokeeType('system'),
            new InvokeeType('user'),
        ]);
        await queryRunner.manager.getRepository(RunStateType).save([
            new RunStateType('running'),
            new RunStateType('paused'),
            new RunStateType('stopped'),
        ]);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
    }

}
