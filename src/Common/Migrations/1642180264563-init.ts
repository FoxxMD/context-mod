import {MigrationInterface, QueryRunner} from "typeorm";

export class init1642180264563 implements MigrationInterface {
    name = 'init1642180264563'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "author" ("id" varchar PRIMARY KEY NOT NULL, "name" varchar(200) NOT NULL)`);
        await queryRunner.query(`CREATE TABLE "subreddit" ("id" varchar PRIMARY KEY NOT NULL, "name" varchar(200) NOT NULL)`);
        await queryRunner.query(`CREATE TABLE "activity" ("id" varchar PRIMARY KEY NOT NULL, "type" varchar(20) NOT NULL, "title" text NOT NULL, "permalink" text NOT NULL, "subredditId" varchar, "authorId" varchar, "submissionId" varchar)`);
        await queryRunner.query(`CREATE TABLE "rule_premise" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "kind" varchar(50) NOT NULL, "config" text NOT NULL, "name" varchar(200) NOT NULL, "configHash" varchar(300) NOT NULL)`);
        await queryRunner.query(`CREATE TABLE "rule_result" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "triggered" boolean, "result" text, "data" text, "actionedEventId" integer, "premiseId" integer)`);
        await queryRunner.query(`CREATE TABLE "action_result" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "kind" varchar(50) NOT NULL, "name" varchar(200), "run" boolean NOT NULL, "dryRun" boolean NOT NULL, "success" boolean NOT NULL, "runReason" text, "result" text, "actionedEventId" integer)`);
        await queryRunner.query(`CREATE TABLE "actioned_event" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "check" varchar(300) NOT NULL, "ruleSummary" text NOT NULL, "timestamp" integer NOT NULL, "bot" varchar(300) NOT NULL, "activityId" varchar)`);
        await queryRunner.query(`CREATE TABLE "temporary_activity" ("id" varchar PRIMARY KEY NOT NULL, "type" varchar(20) NOT NULL, "title" text NOT NULL, "permalink" text NOT NULL, "subredditId" varchar, "authorId" varchar, "submissionId" varchar, CONSTRAINT "FK_e229f9ec17f55f3853dec3fe15b" FOREIGN KEY ("subredditId") REFERENCES "subreddit" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION, CONSTRAINT "FK_0e60c1982a77d3e092ef4f3bef9" FOREIGN KEY ("authorId") REFERENCES "author" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION, CONSTRAINT "FK_01e143ff96808ea360d424577cc" FOREIGN KEY ("submissionId") REFERENCES "activity" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION)`);
        await queryRunner.query(`INSERT INTO "temporary_activity"("id", "type", "title", "permalink", "subredditId", "authorId", "submissionId") SELECT "id", "type", "title", "permalink", "subredditId", "authorId", "submissionId" FROM "activity"`);
        await queryRunner.query(`DROP TABLE "activity"`);
        await queryRunner.query(`ALTER TABLE "temporary_activity" RENAME TO "activity"`);
        await queryRunner.query(`CREATE TABLE "temporary_rule_result" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "triggered" boolean, "result" text, "data" text, "actionedEventId" integer, "premiseId" integer, CONSTRAINT "FK_d68da916aa48db39ca7759e9924" FOREIGN KEY ("actionedEventId") REFERENCES "actioned_event" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION, CONSTRAINT "FK_f5118bf70138c38fa7cf202bb4c" FOREIGN KEY ("premiseId") REFERENCES "rule_premise" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION)`);
        await queryRunner.query(`INSERT INTO "temporary_rule_result"("id", "triggered", "result", "data", "actionedEventId", "premiseId") SELECT "id", "triggered", "result", "data", "actionedEventId", "premiseId" FROM "rule_result"`);
        await queryRunner.query(`DROP TABLE "rule_result"`);
        await queryRunner.query(`ALTER TABLE "temporary_rule_result" RENAME TO "rule_result"`);
        await queryRunner.query(`CREATE TABLE "temporary_action_result" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "kind" varchar(50) NOT NULL, "name" varchar(200), "run" boolean NOT NULL, "dryRun" boolean NOT NULL, "success" boolean NOT NULL, "runReason" text, "result" text, "actionedEventId" integer, CONSTRAINT "FK_bc38f4c1da19fcd85559d92bb76" FOREIGN KEY ("actionedEventId") REFERENCES "actioned_event" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION)`);
        await queryRunner.query(`INSERT INTO "temporary_action_result"("id", "kind", "name", "run", "dryRun", "success", "runReason", "result", "actionedEventId") SELECT "id", "kind", "name", "run", "dryRun", "success", "runReason", "result", "actionedEventId" FROM "action_result"`);
        await queryRunner.query(`DROP TABLE "action_result"`);
        await queryRunner.query(`ALTER TABLE "temporary_action_result" RENAME TO "action_result"`);
        await queryRunner.query(`CREATE TABLE "temporary_actioned_event" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "check" varchar(300) NOT NULL, "ruleSummary" text NOT NULL, "timestamp" integer NOT NULL, "bot" varchar(300) NOT NULL, "activityId" varchar, CONSTRAINT "FK_12fd062d7641df71f790fda4f49" FOREIGN KEY ("activityId") REFERENCES "activity" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION)`);
        await queryRunner.query(`INSERT INTO "temporary_actioned_event"("id", "check", "ruleSummary", "timestamp", "bot", "activityId") SELECT "id", "check", "ruleSummary", "timestamp", "bot", "activityId" FROM "actioned_event"`);
        await queryRunner.query(`DROP TABLE "actioned_event"`);
        await queryRunner.query(`ALTER TABLE "temporary_actioned_event" RENAME TO "actioned_event"`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "actioned_event" RENAME TO "temporary_actioned_event"`);
        await queryRunner.query(`CREATE TABLE "actioned_event" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "check" varchar(300) NOT NULL, "ruleSummary" text NOT NULL, "timestamp" integer NOT NULL, "bot" varchar(300) NOT NULL, "activityId" varchar)`);
        await queryRunner.query(`INSERT INTO "actioned_event"("id", "check", "ruleSummary", "timestamp", "bot", "activityId") SELECT "id", "check", "ruleSummary", "timestamp", "bot", "activityId" FROM "temporary_actioned_event"`);
        await queryRunner.query(`DROP TABLE "temporary_actioned_event"`);
        await queryRunner.query(`ALTER TABLE "action_result" RENAME TO "temporary_action_result"`);
        await queryRunner.query(`CREATE TABLE "action_result" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "kind" varchar(50) NOT NULL, "name" varchar(200), "run" boolean NOT NULL, "dryRun" boolean NOT NULL, "success" boolean NOT NULL, "runReason" text, "result" text, "actionedEventId" integer)`);
        await queryRunner.query(`INSERT INTO "action_result"("id", "kind", "name", "run", "dryRun", "success", "runReason", "result", "actionedEventId") SELECT "id", "kind", "name", "run", "dryRun", "success", "runReason", "result", "actionedEventId" FROM "temporary_action_result"`);
        await queryRunner.query(`DROP TABLE "temporary_action_result"`);
        await queryRunner.query(`ALTER TABLE "rule_result" RENAME TO "temporary_rule_result"`);
        await queryRunner.query(`CREATE TABLE "rule_result" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "triggered" boolean, "result" text, "data" text, "actionedEventId" integer, "premiseId" integer)`);
        await queryRunner.query(`INSERT INTO "rule_result"("id", "triggered", "result", "data", "actionedEventId", "premiseId") SELECT "id", "triggered", "result", "data", "actionedEventId", "premiseId" FROM "temporary_rule_result"`);
        await queryRunner.query(`DROP TABLE "temporary_rule_result"`);
        await queryRunner.query(`ALTER TABLE "activity" RENAME TO "temporary_activity"`);
        await queryRunner.query(`CREATE TABLE "activity" ("id" varchar PRIMARY KEY NOT NULL, "type" varchar(20) NOT NULL, "title" text NOT NULL, "permalink" text NOT NULL, "subredditId" varchar, "authorId" varchar, "submissionId" varchar)`);
        await queryRunner.query(`INSERT INTO "activity"("id", "type", "title", "permalink", "subredditId", "authorId", "submissionId") SELECT "id", "type", "title", "permalink", "subredditId", "authorId", "submissionId" FROM "temporary_activity"`);
        await queryRunner.query(`DROP TABLE "temporary_activity"`);
        await queryRunner.query(`DROP TABLE "actioned_event"`);
        await queryRunner.query(`DROP TABLE "action_result"`);
        await queryRunner.query(`DROP TABLE "rule_result"`);
        await queryRunner.query(`DROP TABLE "rule_premise"`);
        await queryRunner.query(`DROP TABLE "activity"`);
        await queryRunner.query(`DROP TABLE "subreddit"`);
        await queryRunner.query(`DROP TABLE "author"`);
    }

}
