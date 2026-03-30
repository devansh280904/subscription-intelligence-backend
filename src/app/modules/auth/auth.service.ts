import axios from "axios"
import jwt from "jsonwebtoken"
import { googleOAuthConfig } from "../../config/google/oauth"
import prisma from '../../config/prisma'

class AuthService {
    async googleLogin(code: string): Promise<string> {
        // ── Step 1: Exchange code for Google tokens ──────────
        const tokenResponse = await axios.post(
            googleOAuthConfig.tokenEndpoint,
            new URLSearchParams({
                code,
                client_id:     googleOAuthConfig.clientId,
                client_secret: googleOAuthConfig.clientSecret,
                redirect_uri:  'postmessage', // Strictly required for popup flow
                grant_type:    'authorization_code',
            }),
            { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
        );

        const { id_token } = tokenResponse.data;
        if (!id_token) throw new Error('ID Token not returned by Google');

        // ── Step 2: Decode Google's id_token ───────────
        const decoded: any = jwt.decode(id_token);
        if (!decoded?.sub || !decoded?.email) throw new Error('Invalid Google ID Token');

        const googleSub = decoded.sub;
        const email     = decoded.email;
        const name      = decoded.name    ?? email;
        const picture   = decoded.picture ?? null;

        // ── Step 3: Upsert user in DB ────────────────────────────────────
        let user = await prisma.user.findUnique({ where: { googleSub } });

        if (!user) {
            user = await prisma.user.create({
                data: { googleSub, email, ...(name && { name }), ...(picture && { picture }) }
            });
        } else {
            user = await prisma.user.update({
                where: { googleSub },
                data: { ...(name && { name }), ...(picture && { picture }) }
            });
        }

        // ── Step 4: Create app JWT ───────────────
        const appJwt = jwt.sign(
            { userId: user.id, email: user.email, name: user.name ?? name, picture: user.picture ?? picture },
            process.env.JWT_secret || process.env.JWT_SECRET!, // Ensure this matches your .env exactly
            { expiresIn: '3h' }
        );

        return appJwt;
    }
}

export const authService = new AuthService();