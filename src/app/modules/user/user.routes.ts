import { Router } from 'express'
import { authMiddleware, AuthRequest } from '../../middlewares/auth.middleware'         

const router = Router()

router.get('/me', authMiddleware, (req: AuthRequest, res) => {
    res.json({
        message: ' Protected Route accessed',
        user: req.user
    })
})

export default router