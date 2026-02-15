import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';

describe('User API (e2e)', () => {
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

  describe('/user/guest (POST)', () => {
    it('should create a guest account', () => {
      return request(app.getHttpServer())
        .post('/user/guest')
        .expect(201)
        .expect((res) => {
          expect(res.body).toHaveProperty('id');
          expect(res.body).toHaveProperty('nickname', 'guest');
          expect(res.body).toHaveProperty('created_at');
        });
    });
  });

  describe('/user/profile (GET)', () => {
    it('should return 401 when no session token provided', () => {
      return request(app.getHttpServer())
        .get('/user/profile')
        .expect(401);
    });

    it('should return 401 when invalid session token provided', () => {
      return request(app.getHttpServer())
        .get('/user/profile')
        .set('Authorization', 'Bearer invalid-token')
        .expect(401);
    });
  });

  describe('/user/profile (PUT)', () => {
    it('should return 401 when no session token provided', () => {
      return request(app.getHttpServer())
        .put('/user/profile')
        .send({ nickname: 'new-nickname' })
        .expect(401);
    });
  });

  describe('/user/email (POST)', () => {
    it('should return 401 when no session token provided', () => {
      return request(app.getHttpServer())
        .post('/user/email')
        .send({ email: 'test@example.com' })
        .expect(401);
    });
  });
});