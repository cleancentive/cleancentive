import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdminGuard } from '../admin/admin.guard';
import { CostService } from './cost.service';
import { InvoiceIngestService } from './invoice-ingest.service';
import { InvoiceService, type InvoiceCorrection } from './invoice.service';

@ApiTags('cost')
@ApiBearerAuth('Bearer')
@UseGuards(JwtAuthGuard, AdminGuard)
@Controller('admin/cost')
export class CostController {
  constructor(
    private readonly costService: CostService,
    private readonly invoiceService: InvoiceService,
    private readonly invoiceIngest: InvoiceIngestService,
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
  @ApiOperation({ summary: 'Re-read the wiki billing document for invoices we have not seen' })
  @ApiOkResponse({ description: 'Returns how many attachments were scanned, ingested, failed and skipped.' })
  async scanInvoices() {
    const result = await this.invoiceIngest.scan();
    await this.costService.invalidate();
    return result;
  }
}
