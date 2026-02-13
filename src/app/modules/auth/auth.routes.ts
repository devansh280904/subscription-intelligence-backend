import { Router } from 'express';
import { googleAuthController } from './auth.controller';

const router = Router();

router.post('/google', googleAuthController)

export default router;