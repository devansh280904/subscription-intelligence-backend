import type { Request, Response } from 'express';
import { authService } from './auth.service';

export const googleAuthController = async (req: Request, res: Response): Promise<any> => {
    try {
        console.log('[Auth] Callback hit — body keys:', Object.keys(req.body));

        // Only expect 'code' now
        const { code } = req.body;

        if (!code) {
            return res.status(400).json({ message: 'Authorization code is missing' });
        }

        const appJwt = await authService.googleLogin(code);

        console.log('[Auth] JWT generated successfully');

        const payload: any = JSON.parse(
            Buffer.from(appJwt.split('.')[1], 'base64').toString()
        );

        return res.status(200).json({
            accessToken: appJwt,
            user: {
                id:      payload.userId,
                email:   payload.email,
                name:    payload.name    ?? payload.email,
                picture: payload.picture ?? null,
            }
        });

    } catch (error: any) {
        console.error('[Auth] Google authentication failed:', error?.message, error?.response?.data);
        return res.status(500).json({ message: error?.message || 'Google Authentication Failed' });
    }
};