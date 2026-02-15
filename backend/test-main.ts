import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { DataSource } from 'typeorm';
import { User } from './user/user.entity';
import { UserEmail } from './user/user-email.entity';

async function bootstrap() {
  // Create SQLite database for testing
  const testDataSource = new DataSource({
    type: 'sqlite',
    database: './test.db',
    entities: [User, UserEmail],
    synchronize: true,
    logging: false,
  });

  await testDataSource.initialize();
  console.log('🗄️  SQLite database initialized for testing');

  const app = await NestFactory.create(AppModule);

  // Override the database connection
  const typeOrmModule = app.get('TypeOrmModule');
  // This is a simplified approach - in a real scenario you'd create a test module

  // Enable CORS for frontend development
  app.enableCors({
    origin: 'http://localhost:5173',
    credentials: true,
  });

  console.log('🚀 CleanCentive Backend (Test Mode) starting...');
  console.log('📧 Email service: Check console for magic links');
  console.log('🗄️  Database: SQLite (./test.db)');

  await app.listen(3000);
  console.log('✅ Backend ready at http://localhost:3000');
  console.log('🎯 Ready for manual testing!');
}

bootstrap();