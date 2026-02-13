import { Router } from 'express'
import authRoutes from './modules/auth/auth.routes';
import userRoutes from './modules/user/user.routes';
import subscriptionRoutes from './modules/subscription/subscription.routes'; // ← ADD THIS

const router = Router();

router.get('/dashboard', (req, res) => {
    res.json({
        status: 'Ok'
    });
})

router.use('/auth', authRoutes)
router.use('/user', userRoutes)
router.use('/subscriptions', subscriptionRoutes) // ← ADD THIS

export default router