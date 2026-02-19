import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { AuthService } from '../src/auth/auth.service';
import { EmailService } from '../src/email/email.service';
import { UserService } from '../src/user/user.service';

describe('AuthService', () => {
  let service: AuthService;
  let jwtService: JwtService;
  let emailService: EmailService;
  let userService: UserService;

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
          },
        },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
    jwtService = module.get<JwtService>(JwtService);
    emailService = module.get<EmailService>(EmailService);
    userService = module.get<UserService>(UserService);
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
        generateId: jest.fn(),
      };
      const mockToken = 'jwt-token-123';

      jest.spyOn(userService, 'findUserByEmail').mockResolvedValue(mockUser);
      jest.spyOn(jwtService, 'sign').mockReturnValue(mockToken);
      jest.spyOn(emailService, 'sendMagicLink').mockResolvedValue(undefined);

      await service.sendMagicLink('test@example.com');

      expect(userService.findUserByEmail).toHaveBeenCalledWith('test@example.com');
      expect(jwtService.sign).toHaveBeenCalledWith(
        { sub: 'user-123', email: 'test@example.com' },
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