import { UserService } from './service';

describe('UserService', () => {
  it('loads a user', async () => {
    const service = new UserService();
    await service.loadUser();
  });
});
