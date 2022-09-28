import { MigrationInterface, QueryRunner } from "typeorm"
import {RuleType} from "../../../Entities/RuleType";

export class mhs1663609045418 implements MigrationInterface {

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.manager.getRepository(RuleType).save([
            new RuleType('mhs'),
        ]);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
    }

}
