import React from 'react';
import { UserService } from './service';

export function UserPage() {
  const service = new UserService();
  service.loadUser();
  return <button onClick={() => service.saveUser()}>Save</button>;
}

export const userRoute = { method: 'GET', path: '/users/:id', handler: UserPage };
