import { MigrationInterface, QueryRunner } from "typeorm"
import {ActionType} from "../../../Entities/ActionType";

export class submission1661183583080 implements MigrationInterface {

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.manager.getRepository(ActionType).save([
            new ActionType('submission')
        ]);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
    }

}
