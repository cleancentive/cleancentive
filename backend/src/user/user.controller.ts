import { Controller, Get, Param, Res, ParseUUIDPipe } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { UserService } from './user.service';

@Controller('user')
@ApiTags('users')
export class UserController {
  constructor(private readonly userService: UserService) {}

  @Get(':id/avatar')
  async getAvatar(
    @Param('id', ParseUUIDPipe) id: string,
    @Res() res: any,
  ): Promise<void> {
    const result = await this.userService.getAvatarImage(id);
    if (!result) {
      res.status(404).end();
      return;
    }
    res.set('Content-Type', result.contentType);
    res.set('Cache-Control', 'public, max-age=3600');
    res.send(result.buffer);
  }
}
