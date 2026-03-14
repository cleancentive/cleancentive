import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAvatarEmailId1762000000000 implements MigrationInterface {
  name = 'AddAvatarEmailId1762000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" ADD COLUMN "avatar_email_id" UUID REFERENCES "user_emails"("id") ON DELETE SET NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "avatar_email_id"`);
  }
}
