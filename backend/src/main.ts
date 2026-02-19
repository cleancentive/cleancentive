import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { Logger } from '@nestjs/common';
import { AdminService } from './admin/admin.service';

const logger = new Logger('Bootstrap');

async function bootstrap() {
  try {
    const app = await NestFactory.create(AppModule, {
      logger: ['log', 'error', 'warn', 'debug', 'verbose'],
    });

    // Set global API prefix
    app.setGlobalPrefix('api/v1');

    // Enable CORS for frontend development
    app.enableCors({
      origin: process.env.FRONTEND_URL || 'http://localhost:5173',
      credentials: true,
      exposedHeaders: ['x-session-token'],
    });

    // Ensure ADMIN_EMAILS users are promoted on startup
    const adminService = app.get(AdminService);
    await adminService.ensureAdminEmailsPromoted();

    const port = process.env.API_PORT || 3000;
    await app.listen(port);

    logger.log(`🚀 Application is running on: http://localhost:${port}/api/v1`);
    logger.log(`📧 Email service: SMTP (check Mailpit at http://localhost:8025 for dev)`);
  } catch (error) {
    logger.error('Failed to start application');
    
    if (error.message?.includes('ECONNREFUSED') || error.message?.includes('connect')) {
      logger.error('');
      logger.error('❌ Cannot connect to required services (PostgreSQL, Redis, etc.)');
      logger.error('');
      logger.error('💡 Start Docker services first:');
      logger.error('   cd infrastructure && docker compose -f docker-compose.dev.yml up -d');
      logger.error('   or run: bun run dev:infra:start');
      logger.error('');
      logger.error('📋 Check service status:');
      logger.error('   docker compose -f infrastructure/docker-compose.dev.yml ps');
      logger.error('');
    } else {
      logger.error(error.message);
      logger.error(error.stack);
    }
    
    process.exit(1);
  }
}

bootstrap();
