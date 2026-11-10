import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdminGuard } from '../admin/admin.guard';
import { CostService } from './cost.service';
import { CostAlertService } from './cost-alert.service';
import { InvoiceScanStatusStore } from './invoice-scan-status';
import { InvoiceService, type InvoiceCorrection } from './invoice.service';

@ApiTags('cost')
@ApiBearerAuth('Bearer')
@UseGuards(JwtAuthGuard, AdminGuard)
@Controller('admin/cost')
export class CostController {
  constructor(
    private readonly costService: CostService,
    private readonly invoiceService: InvoiceService,
    private readonly costAlert: CostAlertService,
    private readonly scanStatus: InvoiceScanStatusStore,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Get projected monthly cost per vendor plus invoiced history' })
  @ApiOkResponse({ description: 'Returns computed run-rate, metered detection spend, and parsed invoices.' })
  async getCost() {
    return this.costService.getSnapshot();
  }

  @Get('invoices')
  @ApiOperation({ summary: 'List the invoices parsed out of the wiki billing document' })
  @ApiOkResponse({ description: 'Returns invoices newest first, including ones that could not be read.' })
  async listInvoices() {
    return this.invoiceService.list();
  }

  @Patch('invoices/:id')
  @ApiOperation({ summary: 'Correct and confirm a parsed invoice' })
  @ApiOkResponse({ description: 'Returns the corrected invoice.' })
  async correctInvoice(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() correction: InvoiceCorrection,
    @Req() req: any,
  ) {
    const invoice = await this.invoiceService.correct(id, correction, req.user.userId);
    await this.costService.invalidate();
    return invoice;
  }

  @Post('invoices/scan')
  @HttpCode(202)
  @ApiOperation({ summary: 'Queue a scan of the wiki billing document for invoices we have not seen' })
  @ApiOkResponse({ description: 'The scan runs in the background; poll invoices/scan-status for progress.' })
  async scanInvoices() {
    // Queued, not awaited: OCR'ing a backlog of PDFs one by one takes minutes,
    // far past the reverse proxy's timeout.
    await this.costAlert.requestInvoiceScan(0);
    return this.scanStatus.get();
  }

  @Get('invoices/scan-status')
  @ApiOperation({ summary: 'Progress of the current or most recent invoice scan' })
  @ApiOkResponse({ description: 'Returns state, how many PDFs are done of how many, and the outcome counts.' })
  async getScanStatus() {
    return this.scanStatus.get();
  }
}
