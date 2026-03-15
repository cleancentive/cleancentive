import { MigrationInterface, QueryRunner } from 'typeorm';

export class RenameAdminToOrganizer1765000000000 implements MigrationInterface {
  name = 'RenameAdminToOrganizer1765000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`UPDATE "team_memberships" SET "role" = 'organizer' WHERE "role" = 'admin'`);
    await queryRunner.query(`UPDATE "cleanup_participants" SET "role" = 'organizer' WHERE "role" = 'admin'`);
    await queryRunner.query(`UPDATE "team_messages" SET "audience" = 'organizers' WHERE "audience" = 'admins'`);
    await queryRunner.query(`UPDATE "cleanup_messages" SET "audience" = 'organizers' WHERE "audience" = 'admins'`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`UPDATE "team_memberships" SET "role" = 'admin' WHERE "role" = 'organizer'`);
    await queryRunner.query(`UPDATE "cleanup_participants" SET "role" = 'admin' WHERE "role" = 'organizer'`);
    await queryRunner.query(`UPDATE "team_messages" SET "audience" = 'admins' WHERE "audience" = 'organizers'`);
    await queryRunner.query(`UPDATE "cleanup_messages" SET "audience" = 'admins' WHERE "audience" = 'organizers'`);
  }
}
