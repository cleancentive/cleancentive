import { MigrationInterface, QueryRunner } from 'typeorm';

export class FixOrganizerRoleConstraints1768000000000 implements MigrationInterface {
  name = 'FixOrganizerRoleConstraints1768000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "team_memberships" DROP CONSTRAINT "CHK_team_memberships_role"`);
    await queryRunner.query(
      `ALTER TABLE "team_memberships" ADD CONSTRAINT "CHK_team_memberships_role" CHECK ("role" IN ('member', 'organizer'))`,
    );
    await queryRunner.query(`ALTER TABLE "cleanup_participants" DROP CONSTRAINT "CHK_cleanup_participants_role"`);
    await queryRunner.query(
      `ALTER TABLE "cleanup_participants" ADD CONSTRAINT "CHK_cleanup_participants_role" CHECK ("role" IN ('member', 'organizer'))`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "cleanup_participants" DROP CONSTRAINT "CHK_cleanup_participants_role"`);
    await queryRunner.query(
      `ALTER TABLE "cleanup_participants" ADD CONSTRAINT "CHK_cleanup_participants_role" CHECK ("role" IN ('member', 'admin'))`,
    );
    await queryRunner.query(`ALTER TABLE "team_memberships" DROP CONSTRAINT "CHK_team_memberships_role"`);
    await queryRunner.query(
      `ALTER TABLE "team_memberships" ADD CONSTRAINT "CHK_team_memberships_role" CHECK ("role" IN ('member', 'admin'))`,
    );
  }
}
