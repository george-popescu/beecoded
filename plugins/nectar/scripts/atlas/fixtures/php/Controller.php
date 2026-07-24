<?php

namespace App\Http\Controllers;

use App\Services\UserService;

final class UserController extends BaseController
{
    public function show(UserService $service): array
    {
        return $service->loadUser();
    }
}

Route::get('/users/{id}', [UserController::class, 'show']);
