import axios from "axios"
import jwt from "jsonwebtoken"
import { googleOAuthConfig } from "../../config/google/oauth"    
import prisma from '../../config/prisma'

class AuthService{
    // to seee tokens sent by google Promise<{googleTokens: any; Jwtapp:string}> and return { googleTokens, Jwtapp}
    async googleLogin(code: string, codeVerfier: string): Promise<string>{
        const tokenResponse = await axios.post(googleOAuthConfig.tokenEndpoint,
            new URLSearchParams({
                code,
                code_verifier: codeVerfier,
                client_id: googleOAuthConfig.clientId,
                client_secret: googleOAuthConfig.clientSecret,
                redirect_uri: googleOAuthConfig.redirectUri,
                grant_type: 'authorization_code',
            }),
            {
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                },
            }
        );

        /* google returns this from above request
            {   
                "access_token": "...",
                "expires_in": 3599,
                "refresh_token": "...",
                "id_token": "eyJhbGciOiJSUzI1NiIs..."
            }
        */

        // We Need Only Id token for email and profile info
        const googleTokens = tokenResponse.data;
        const { id_token } = googleTokens

        if(!id_token){
            throw new Error('ID Token not returned by Google');
        }

        /* using jwt library to decode the id_token to get user info
            
            we use decode instead of verify because we are not verifying signature here
            just extracting the payload, verification was done by google when we exchanged code for tokens
           
            we get payload like this after decoding id_token
        {
            "sub": "109876543210",
            "email": "user@gmail.com",
            "email_verified": true,
            "name": "John Doe",
            "picture": "...",
            "iss": "https://accounts.google.com",
            "aud": "YOUR_CLIENT_ID",
            "exp": 1710000000
        }
        */
        const decoded: any =  jwt.decode(id_token);

        // deocded? means if and only if its not null check .sub and similarly .email. If either of those are missing return error message
        if(!decoded?.sub || !decoded?.email){
            throw new Error('Invalid Google ID Token')
        }


        //we will Decode the provider's id (googlesub) and email from the token we got from the google.
        const googleSub = decoded.sub;
        const email = decoded.email;


        // when users logs-in in again through same provider it will check the provider's(googlesub) id exists in db 
        // if user exixts we fetch user data from db
        let user = await prisma.user.findUnique({
            where: { googleSub }
        })

        /* 
        if user  is new and doesnt exist in our db we add the user in the db

        But if user logs-in with different provider 2nd time provider's id willl be differennt and it will not be linked with the user, so in that case we will check email 

        for example: If a user logs in with Google first time, then later uses GitHub, GitHub providerId won’t exist but the user already exists in DB, so we check email

         And prisma will automatically create our db's userid which will be used for further identification of users
        */
        if(!user){
            user = await prisma.user.create({
                data: {
                    // in db userid will also be there with these columns
                    googleSub,
                    email
                }
            })
        }

        // we will create our own tokens for our app using jwt with sub and email we got from payload body of the token. Jwt secret key is used, along with expiration time 

        // now instead of using the provider's id (googlesub) and email to ceate the jwt token as mentioned above we will use the userid which was created by prisma directly in the db along with the email of that user to create the jwt token 
        const appJwt = jwt.sign(
        {
            userId: user.id,
            email: user.email,
        },
        process.env.JWT_secret!,
        {
            expiresIn: '3h'
        }
    );

        // Returning our token back to thr controller
        return appJwt ;
    }
}

export const authService = new AuthService ()