import axios from 'axios'

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';


/* this is the purpose of this file 
When a user clicks “Allow Gmail access”, Google does NOT give you access to Gmail immediately.

It takes the temporary code Google gives you after the user clicks “Allow” and trades it for real Gmail access ke

Here’s a short-lived authorization code.
If you are really the app owner, come back to me with this code and your secret
*/
export async function exchangeCodeForGmailTokens(code: string) {
    const response = await axios.post(
        GOOGLE_TOKEN_URL, {
        code,
        client_id: process.env.GOOGLE_CLIENT_ID!,
        client_secret: process.env.GOOGLE_CLIENT_SECRET!,
        redirect_uri: process.env.GMAIL_REDIRECT_URI!,
        grant_type: 'authorization_code',
    },
        {
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            }
        }
    )

    /*
    {
    these are the keys google sends 
      "access_token": "...",
      "refresh_token": "...",
      "expires_in": 3599
    }

    */
    return response.data
}