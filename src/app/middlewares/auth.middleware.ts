import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

interface JwtPayload {
    userId: string;
    email: string;
}

export interface AuthRequest extends Request {
    user?: JwtPayload;
}

export const authMiddleware = (req: AuthRequest, res: Response, next: NextFunction): any => {
    const authHeader = req.headers.authorization;
    const tokenFromQuery = req.query.token as string | undefined;
    
    let token: string | undefined;

    if (authHeader?.startsWith('Bearer ')) {
        token = authHeader.split(' ')[1];
    } else if (tokenFromQuery) {
        token = tokenFromQuery;
    }

    if (!token) {
        return res.status(401).json({
            message: 'Token missing or unauthorized'
        });
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET!) as JwtPayload;
        req.user = decoded;
        next();
    } catch (error) {
        return res.status(401).json({
            message: 'Invalid or expired token'
        });
    }
};