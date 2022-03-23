import {MigrationInterface, QueryRunner} from "typeorm";

export class initialData1642180274563 implements MigrationInterface {

    name = 'initialData1642180274563';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`INSERT INTO "rule_type"("name") VALUES ("recent"), ("repeat"), ("author"), ("attribution"), ("history"), ("regex"), ("repost")`);
        await queryRunner.query(`INSERT INTO "action_type"("name") VALUES ("comment"), ("lock"), ("remove"), ("report"), ("approve"), ("ban"), ("flair"), ("usernote"), ("message"), ("userflair"), ("dispatch"), ("cancelDispatch"), ("contributor")`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
    }

}