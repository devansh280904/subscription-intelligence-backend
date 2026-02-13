import querystring from 'querystring'
import { GMAIL_SCOPES, GOOGLE_OAUTH_BASE_URL } from './gmail.constants'
import axios from 'axios';

// this is the url which will be sent to the google with all the params
export function getGmailauthUrl(userId: string) {
    const params = {
        client_id: process.env.GOOGLE_CLIENT_ID!,
        redirect_uri: process.env.GMAIL_REDIRECT_URI!,
        response_type: 'code',
        scope: GMAIL_SCOPES.join(' '),
        access_type: 'offline',
        prompt: 'consent',
        state: userId,
    }

    // base URL is imported from GOOGLE_OAUTH_BASE_URL in .env which isthen joined with the above params after stringfying 
    return `${GOOGLE_OAUTH_BASE_URL}?${querystring.stringify(params)}`
}


export async function testGmailConnection(accessToken: string) {
  // mkaes a http request and waits until gmail responds 
    const response = await axios.get(
    'https://gmail.googleapis.com/gmail/v1/users/me/profile',
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    }
  );

  /*
   google will return this 
  {
    "emailAddress": "user@gmail.com",
    "messagesTotal": 12345,
    "threadsTotal": 6789,
    "historyId": "123456"                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 
    }
  */
  return response.data;
}
