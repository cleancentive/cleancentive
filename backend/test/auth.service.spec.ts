import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AuthService } from '../src/auth/auth.service';
import { EmailService } from '../src/email/email.service';
import { UserService } from '../src/user/user.service';
import { AdminService } from '../src/admin/admin.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { PendingAuthRequest } from '../src/auth/pending-auth-request.entity';
import { DeviceCode } from '../src/auth/device-code.entity';

describe('AuthService', () => {
  let service: AuthService;
  let jwtService: JwtService;
  let emailService: EmailService;
  let userService: UserService;
  let adminService: AdminService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        {
          provide: JwtService,
          useValue: {
            sign: jest.fn(),
            verify: jest.fn(),
          },
        },
        {
          provide: EmailService,
          useValue: {
            sendMagicLink: jest.fn(),
          },
        },
        {
          provide: UserService,
          useValue: {
            findUserByEmail: jest.fn(),
            findOrCreateGuest: jest.fn(),
            validateAndAssociateEmail: jest.fn(),
            mergeGuestAccount: jest.fn(),
            updateLastLogin: jest.fn(),
          },
        },
        {
          provide: AdminService,
          useValue: {
            isAdminEmail: jest.fn().mockReturnValue(false),
            promoteToAdmin: jest.fn(),
          },
        },
        {
          provide: EventEmitter2,
          useValue: { emit: jest.fn() },
        },
        {
          provide: getRepositoryToken(PendingAuthRequest),
          useValue: {
            save: jest.fn(),
            findOne: jest.fn(),
            update: jest.fn(),
            delete: jest.fn(),
          },
        },
        {
          provide: getRepositoryToken(DeviceCode),
          useValue: {
            save: jest.fn(),
            findOne: jest.fn(),
            update: jest.fn(),
            delete: jest.fn(),
            count: jest.fn().mockResolvedValue(0),
            createQueryBuilder: jest.fn().mockReturnValue({
              delete: jest.fn().mockReturnThis(),
              where: jest.fn().mockReturnThis(),
              execute: jest.fn().mockResolvedValue({}),
            }),
          },
        },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
    jwtService = module.get<JwtService>(JwtService);
    emailService = module.get<EmailService>(EmailService);
    userService = module.get<UserService>(UserService);
    adminService = module.get<AdminService>(AdminService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('sendMagicLink', () => {
    it('should send magic link for existing user', async () => {
      const mockUser = {
        id: 'user-123',
        nickname: 'testuser',
        full_name: null,
        emails: [],
        last_login: null,
        created_at: new Date(),
        updated_at: new Date(),
        created_by: null,
        updated_by: null,
        active_team_id: null,
        active_cleanup_date_id: null,
        avatar_email_id: null,
        generateId: jest.fn(),
      };
      const mockToken = 'jwt-token-123';

      jest.spyOn(userService, 'findUserByEmail').mockResolvedValue(mockUser);
      jest.spyOn(jwtService, 'sign').mockReturnValue(mockToken);
      jest.spyOn(emailService, 'sendMagicLink').mockResolvedValue(undefined);

      await service.sendMagicLink('test@example.com');

      expect(userService.findUserByEmail).toHaveBeenCalledWith('test@example.com');
      expect(jwtService.sign).toHaveBeenCalledWith(
        expect.objectContaining({ sub: 'user-123', email: 'test@example.com' }),
        { expiresIn: '24h' }
      );
      expect(emailService.sendMagicLink).toHaveBeenCalledWith(
        'test@example.com',
        expect.stringContaining('auth/verify?token=jwt-token-123')
      );
    });

    it('should not send email for non-existent user (security)', async () => {
      jest.spyOn(userService, 'findUserByEmail').mockResolvedValue(null);

      await service.sendMagicLink('nonexistent@example.com');

      expect(userService.findUserByEmail).toHaveBeenCalledWith('nonexistent@example.com');
      expect(emailService.sendMagicLink).not.toHaveBeenCalled();
    });
  });

  describe('verifyMagicLink', () => {
    it('should verify valid token', async () => {
      const mockPayload = { sub: 'user-123', email: 'test@example.com' };

      jest.spyOn(jwtService, 'verify').mockReturnValue(mockPayload);
      jest.spyOn(adminService, 'isAdminEmail').mockReturnValue(false);

      const result = await service.verifyMagicLink('valid-token');

      expect(jwtService.verify).toHaveBeenCalledWith('valid-token');
      expect(result).toEqual({ userId: 'user-123', email: 'test@example.com' });
    });

    it('should throw error for invalid token', async () => {
      jest.spyOn(jwtService, 'verify').mockImplementation(() => {
        throw new Error('Invalid token');
      });

      await expect(service.verifyMagicLink('invalid-token')).rejects.toThrow('Invalid or expired magic link');
    });
  });

  describe('generateSessionToken', () => {
    it('should generate JWT token for user', async () => {
      const mockToken = 'session-token-123';
      jest.spyOn(jwtService, 'sign').mockReturnValue(mockToken);

      const result = await service.generateSessionToken('user-123');

      expect(jwtService.sign).toHaveBeenCalledWith({ sub: 'user-123' });
      expect(result).toBe(mockToken);
    });
  });
});
