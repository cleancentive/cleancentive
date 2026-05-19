import {
  ArgumentsHost,
  BadRequestException,
  Catch,
  ExceptionFilter,
  PayloadTooLargeException,
} from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import { MulterError } from 'multer';

@Catch(MulterError)
export class MulterExceptionFilter extends BaseExceptionFilter implements ExceptionFilter {
  catch(error: MulterError, host: ArgumentsHost) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      super.catch(new PayloadTooLargeException(`Upload exceeds maximum allowed size`), host);
      return;
    }
    super.catch(new BadRequestException(error.message || 'Upload failed'), host);
  }
}
