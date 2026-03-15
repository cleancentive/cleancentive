import { Injectable, NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common';
import { Observable } from 'rxjs';
import { requestContext } from './request-context';

@Injectable()
export class RequestContextInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    const userId = request.user?.userId as string | undefined;

    return new Observable((subscriber) => {
      requestContext.run({ userId }, () => {
        next.handle().subscribe(subscriber);
      });
    });
  }
}
