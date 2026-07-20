require('dotenv').config();
const http = require('http');
const { URL } = require('url');
const { google } = require('googleapis');

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const PORT = 53682;
const REDIRECT_URI = `http://localhost:${PORT}/oauth2callback`;

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error('Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET (env vars or backend/.env) before running this script.');
  process.exit(1);
}

const oauth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);

const authUrl = oauth2Client.generateAuthUrl({
  access_type: 'offline',
  prompt: 'consent',
  scope: ['https://www.googleapis.com/auth/gmail.send'],
});

console.log('\n1. Open this URL in your browser, and sign in as the Gmail account you want to send from:\n');
console.log(authUrl);
console.log('\n2. Approve access. You will be redirected to localhost — this script is waiting for that.\n');

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, REDIRECT_URI);
    if (url.pathname !== '/oauth2callback') {
      res.writeHead(404).end();
      return;
    }

    const code = url.searchParams.get('code');
    if (!code) {
      res.writeHead(400).end('Missing ?code param.');
      return;
    }

    const { tokens } = await oauth2Client.getToken(code);
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end('<h2>Success — you can close this tab and return to the terminal.</h2>');

    console.log('\nDone! Add this to your Render environment variables:\n');
    console.log(`GOOGLE_REFRESH_TOKEN=${tokens.refresh_token}`);
    console.log('\n(If GOOGLE_REFRESH_TOKEN is missing above, revoke prior access at https://myaccount.google.com/permissions and re-run this script — Google only issues a refresh token on first consent.)\n');

    server.close();
    process.exit(0);
  } catch (err) {
    console.error('Token exchange failed:', err.message);
    res.writeHead(500).end('Token exchange failed, see terminal.');
    server.close();
    process.exit(1);
  }
});

server.listen(PORT, () => {
  console.log(`Waiting for the OAuth redirect on ${REDIRECT_URI} ...`);
});
