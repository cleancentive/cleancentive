import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';

describe('Auth API (e2e)', () => {
  let app: INestApplication;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  describe('/auth/magic-link (POST)', () => {
    it('should accept magic link request', () => {
      return request(app.getHttpServer())
        .post('/auth/magic-link')
        .send({ email: 'test@example.com' })
        .expect(201)
        .expect((res) => {
          expect(res.body).toHaveProperty('message');
          expect(res.body.message).toContain('Magic link sent');
        });
    });

    it('should reject invalid email format', () => {
      return request(app.getHttpServer())
        .post('/auth/magic-link')
        .send({ email: 'invalid-email' })
        .expect(400);
    });

    it('should reject missing email', () => {
      return request(app.getHttpServer())
        .post('/auth/magic-link')
        .send({})
        .expect(400);
    });
  });

  describe('/auth/verify (GET)', () => {
    it('should return 401 when no token provided', () => {
      return request(app.getHttpServer())
        .get('/auth/verify')
        .expect(401);
    });

    it('should return 401 when invalid token provided', () => {
      return request(app.getHttpServer())
        .get('/auth/verify?token=invalid-token')
        .expect(401);
    });
  });
});