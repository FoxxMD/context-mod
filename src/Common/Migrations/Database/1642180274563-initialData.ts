import {MigrationInterface, QueryRunner} from "typeorm";

export class initialData1642180274563 implements MigrationInterface {

    name = 'initialData1642180274563';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`INSERT INTO "RuleType"("name") VALUES ("recent"), ("repeat"), ("author"), ("attribution"), ("history"), ("regex"), ("repost")`);
        await queryRunner.query(`INSERT INTO "ActionType"("name") VALUES ("comment"), ("lock"), ("remove"), ("report"), ("approve"), ("ban"), ("flair"), ("usernote"), ("message"), ("userflair"), ("dispatch"), ("cancelDispatch"), ("contributor")`);
        await queryRunner.query(`INSERT INTO "InvokeeType"("name") VALUES ("system"), ("user")`);
        await queryRunner.query(`INSERT INTO "RunStateType"("name") VALUES ("running"), ("paused"), ("stopped")`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
    }

}
