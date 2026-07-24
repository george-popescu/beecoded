<?php

namespace Tests;

use App\Services\UserService;

final class ControllerTest extends TestCase
{
    public function testLoadsUser(): void
    {
        $service = new UserService();
        $service->loadUser();
    }
}
