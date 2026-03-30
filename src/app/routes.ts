import { Router } from 'express'
import authRoutes from './modules/auth/auth.routes';
import userRoutes from './modules/user/user.routes';
import subscriptionRoutes from './modules/subscription/subscription.routes'; // ← ADD THIS
// import debugRoutes from './modules/gmail/gmail.debug.routes'
const router = Router();

router.get('/dashboard', (req, res) => {
    res.json({
        status: 'Ok'
    });
})

router.use('/auth', authRoutes)
router.use('/user', userRoutes)
router.use('/subscriptions', subscriptionRoutes) // ← ADD THIS
// router.use('/', debugRoutes)
export default router