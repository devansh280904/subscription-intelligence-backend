import express  from 'express';
import type { Request, Response } from 'express';
import { authService } from './auth.service';

export const googleAuthController = async (req: Request, res: Response) => {
    try {
        // fetching authorization code and code verifier from the client's login request 
        const { code, codeVerifier } = req.body;

        //if either is not present sending the error message 
        if(!code || ! codeVerifier){
            return res.status(400).json({
                message: 'Authorization code or code Verifier is missing'
            })
        }

        // calling authservice to verifiy the token and code. And to generate new app token by sending them code and codeverifier.
        const tokens = await authService.googleLogin(code, codeVerifier);

        return res.status(200).json({tokens})
    } catch (error) {
        res.status(500).json({
            message: 'Google Authentication Failed',
        });
    }
}