import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddGuestTokenIssuedAt1777500000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Marks that a guest session token has been handed out for this id.
    //
    // Guest ids used to be generated in the browser and sent as a plain
    // parameter, which made a public identifier into a credential: anyone who
    // read a user id off a spot page could pass it as their own guestId. Ids
    // already in people's localStorage are exchanged for a real token once —
    // that is what this column records, so the same id cannot be exchanged
    // again by somebody who merely knows it.
    await queryRunner.query(
      `ALTER TABLE "users" ADD COLUMN "guest_token_issued_at" TIMESTAMP WITH TIME ZONE NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "guest_token_issued_at"`);
  }
}
