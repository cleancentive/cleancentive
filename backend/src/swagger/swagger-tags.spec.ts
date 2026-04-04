import 'reflect-metadata';
import { describe, expect, test } from 'bun:test';
import { DECORATORS } from '@nestjs/swagger/dist/constants';

import { AdminController } from '../admin/admin.controller';
import { AuthController } from '../auth/auth.controller';
import { CleanupController } from '../cleanup/cleanup.controller';
import { FeedbackController } from '../feedback/feedback.controller';
import { LabelController } from '../label/label.controller';
import { SpotController } from '../spot/spot.controller';
import { TeamController } from '../team/team.controller';
import { UserController } from '../user/user.controller';
import { UserProfileController } from '../user/user-profile.controller';

describe('swagger tags', () => {
  test('assigns explicit tags to controllers that would otherwise appear under default', () => {
    expect(Reflect.getMetadata(DECORATORS.API_TAGS, AuthController)).toEqual(['auth']);
    expect(Reflect.getMetadata(DECORATORS.API_TAGS, FeedbackController)).toEqual(['feedback']);
    expect(Reflect.getMetadata(DECORATORS.API_TAGS, SpotController)).toEqual(['spots']);
    expect(Reflect.getMetadata(DECORATORS.API_TAGS, LabelController)).toEqual(['labels']);
    expect(Reflect.getMetadata(DECORATORS.API_TAGS, CleanupController)).toEqual(['cleanups']);
    expect(Reflect.getMetadata(DECORATORS.API_TAGS, TeamController)).toEqual(['teams']);
    expect(Reflect.getMetadata(DECORATORS.API_TAGS, AdminController)).toEqual(['admin']);
    expect(Reflect.getMetadata(DECORATORS.API_TAGS, UserController)).toEqual(['users']);
    expect(Reflect.getMetadata(DECORATORS.API_TAGS, UserProfileController)).toEqual(['profile']);
  });
});
