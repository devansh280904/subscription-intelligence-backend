import { Request, Response } from "express";
import { exchangeCodeForGmailTokens } from "./gmail.oauth";
import prisma from '../../config/prisma'
import { ref } from "node:process";

export const gmailCallback = async (req: Request, res: Response) => {
    const { code, state } = req.query;

    if(!code || !state){
        return res.status(400).json({
            message: 'missing code or status'
        })
    }
    const userId = state as string;

    try {
        const tokenData = await exchangeCodeForGmailTokens(code as string)

        const {
            access_token,
            refresh_token,
            expires_in,
        } = tokenData

    if(!access_token || !refresh_token){
        return res.status(400).json({
            message: 'invalid Gmail token Response'
        })
    }

    const expiresAt = new Date(Date.now() + expires_in * 1000);
    await prisma.gmailAccount.upsert({
        where: {userId},
        update: {
            accessToken: access_token,
            refreshToken: refresh_token,
            expiresAt,
        },
        create:{
            userId,
            accessToken: access_token,
            refreshToken: refresh_token,
            expiresAt,
        },
    })
    return res.json({
        message: 'Gmail connected Successfully',
    })
    } catch (error) {
        console.error('Gmail callback error', error);
        return res.status(500).json({
            message: 'Failed to connect gmail'
        })
    }
}