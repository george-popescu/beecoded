<?php

namespace App\Services;

interface Persistable
{
    public function saveUser(): void;
}

final class UserService extends BaseService implements Persistable
{
    public function loadUser(): array
    {
        return fetchUser();
    }

    public function saveUser(): void
    {
        persistUser();
    }
}
