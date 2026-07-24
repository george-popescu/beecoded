export interface Persistable {
  saveUser(): Promise<void>;
}

export class UserService extends BaseService implements Persistable {
  async loadUser(): Promise<string> {
    return fetchUser();
  }

  async saveUser(): Promise<void> {
    await persistUser();
  }
}
