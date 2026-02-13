import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';


// This is th epayload shape we sued to create jwt token. ex. jwt.sign({ userId: string; email:string; })
interface JwtPayload {
    userId: string;
    email: string;
}

/*
Express’s Request type does not include user.
AuthRequest = Express Request plus an optional authenticated user

This creates a new request type that:
    contains everything Request has
    plus an optional user field

Why optional (?)?
    Before middleware runs → req.user does not exist
    After verification → req.user exists
*/

export interface AuthRequest extends Request {
    user?: JwtPayload;
}

export function authMiddleware(req: AuthRequest, res: Response, next: NextFunction) {

    /*
    Express parses headers
    authorization is a string or undefined 
    ex. Bearer <JWT>
    */
    const authHeader = req.headers.authorization;
    const tokenFromQuery = req.query.token as string | undefined;
    
    let token: string | undefined

    if(authHeader?.startsWith('Bearer')){
        token = authHeader.split(' ')[1];
    }

    else if(tokenFromQuery){
        token = tokenFromQuery
    }
    // if (!authHeader) {
    //     return res.status(401).json({
    //         message: 'Authorization header is missing'
    //     })
    // }

    /* "Bearer abc.def.ghi".split(' ')
    → ["Bearer", "abc.def.ghi"] */
    // const token = authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({
            message: 'Token missing'
        })
    }
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET!) as JwtPayload

        /* req now has a user property

        This property persists for the rest of the request lifecycle*/
        req.user = decoded;
        next();
    } catch (error) {
        return res.status(401).json({
            message: 'Invalid or expired token'
        })
    }



}

