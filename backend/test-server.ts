import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { TestAppModule } from './src/test-app.module';

async function bootstrap() {
  const app = await NestFactory.create(TestAppModule);

  // Enable CORS for frontend development
  app.enableCors({
    origin: 'http://localhost:5173',
    credentials: true,
  });

  console.log('🚀 CleanCentive Backend (Test Mode) starting...');
  console.log('📧 Email service: MOCK MODE (check console for magic links)');
  console.log('🗄️  Database: SQLite in-memory');

  await app.listen(3000);
  console.log('✅ Backend ready at http://localhost:3000');
  console.log('🎯 Ready for manual testing!');
}

bootstrap();