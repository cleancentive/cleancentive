import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { VendorInvoice } from './vendor-invoice.entity';
import { UserEmail } from '../user/user-email.entity';
import { CostController } from './cost.controller';
import { CostService } from './cost.service';
import { InvoiceService } from './invoice.service';
import { InvoiceIngestService } from './invoice-ingest.service';
import { CostAlertService } from './cost-alert.service';
import { AdminModule } from '../admin/admin.module';
import { AdminGuard } from '../admin/admin.guard';
import { OutlineSyncModule } from '../outline-sync/outline-sync.module';
import { StorageModule } from '../storage/storage.module';
import { EmailModule } from '../email/email.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([VendorInvoice, UserEmail]),
    AdminModule,
    OutlineSyncModule,
    StorageModule,
    EmailModule,
  ],
  // AdminModule exports AdminService but not AdminGuard, so the guard is
  // provided here too. It holds no state, so a second instance costs nothing.
  providers: [AdminGuard, CostService, InvoiceService, InvoiceIngestService, CostAlertService],
  controllers: [CostController],
  exports: [CostAlertService],
})
export class CostModule {}
