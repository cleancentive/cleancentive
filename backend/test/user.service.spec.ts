import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UserService } from '../src/user/user.service';
import { User } from '../src/user/user.entity';
import { UserEmail } from '../src/user/user-email.entity';

describe('UserService', () => {
  let service: UserService;
  let userRepository: Repository<User>;
  let userEmailRepository: Repository<UserEmail>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserService,
        {
          provide: getRepositoryToken(User),
          useClass: Repository,
        },
        {
          provide: getRepositoryToken(UserEmail),
          useClass: Repository,
        },
      ],
    }).compile();

    service = module.get<UserService>(UserService);
    userRepository = module.get<Repository<User>>(getRepositoryToken(User));
    userEmailRepository = module.get<Repository<UserEmail>>(getRepositoryToken(UserEmail));
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('validateEmailFormat', () => {
    it('should validate correct email formats', () => {
      expect((service as any).validateEmailFormat('test@example.com')).toBe(true);
      expect((service as any).validateEmailFormat('user.name+tag@domain.co.uk')).toBe(true);
    });

    it('should reject invalid email formats', () => {
      expect((service as any).validateEmailFormat('invalid-email')).toBe(false);
      expect((service as any).validateEmailFormat('@example.com')).toBe(false);
      expect((service as any).validateEmailFormat('test@')).toBe(false);
    });
  });

  describe('createGuestAccount', () => {
    it('should create a guest user with UUID and nickname "guest"', async () => {
      const mockUser = { id: 'uuid-123', nickname: 'guest' };
      jest.spyOn(userRepository, 'create').mockReturnValue(mockUser as any);
      jest.spyOn(userRepository, 'save').mockResolvedValue(mockUser as any);

      const result = await service.createGuestAccount();

      expect(userRepository.create).toHaveBeenCalledWith({ nickname: 'guest' });
      expect(userRepository.save).toHaveBeenCalledWith(mockUser);
      expect(result).toEqual(mockUser);
    });
  });
});