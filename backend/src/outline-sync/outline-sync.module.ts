import { Module } from '@nestjs/common';
import { OutlineSyncService } from './outline-sync.service';
import { UserModule } from '../user/user.module';
import { AdminModule } from '../admin/admin.module';

@Module({
  imports: [UserModule, AdminModule],
  providers: [OutlineSyncService],
  exports: [OutlineSyncService],
})
export class OutlineSyncModule {}
