import { ArgumentsHost, Catch, ExceptionFilter } from '@nestjs/common';
import type { Response } from 'express';
import { RateLimitExceededException } from './redis-rate-limit';

/** Adds `Retry-After` to the 429s thrown by the Redis rate limiter. */
@Catch(RateLimitExceededException)
export class RateLimitExceptionFilter implements ExceptionFilter<RateLimitExceededException> {
  catch(exception: RateLimitExceededException, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    response.status(exception.getStatus());
    response.setHeader('Retry-After', String(exception.retryAfterSeconds));
    response.json({
      statusCode: exception.getStatus(),
      message: exception.message,
      retryAfterSeconds: exception.retryAfterSeconds,
    });
  }
}
