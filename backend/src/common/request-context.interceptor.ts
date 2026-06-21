import { Injectable, NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common';
import { Observable } from 'rxjs';
import { normalizeLocale, parseAcceptLanguage } from '@cleancentive/shared';
import { requestContext } from './request-context';

@Injectable()
export class RequestContextInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    const userId = request.user?.userId as string | undefined;

    // Per-request locale precedence: explicit `?locale=` override (deep links,
    // test scripts) → browser Accept-Language → default. The authenticated
    // user's stored preference is applied per-recipient at email-send time.
    const queryLocale = request.query?.locale as string | undefined;
    const locale = queryLocale
      ? normalizeLocale(queryLocale)
      : parseAcceptLanguage(request.headers?.['accept-language']);

    return new Observable((subscriber) => {
      requestContext.run({ userId, locale }, () => {
        next.handle().subscribe(subscriber);
      });
    });
  }
}
