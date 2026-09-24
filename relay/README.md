# Download relay

Project Gutenberg doesn't send [CORS](https://developer.mozilla.org/docs/Web/HTTP/CORS)
headers, so browsers block web apps like Read Free from downloading its books.
Standard Ebooks, your own files and the bundled classics work without a relay.

This folder is a ~60-line [Cloudflare Worker](https://developers.cloudflare.com/workers/)
that fetches books **only** from Gutenberg's hosts and adds the missing header.
It stores nothing and keeps no logs. Cloudflare's free plan (100,000 requests a
day) is far more than one reader needs.

## Deploy (about 5 minutes)

1. Create a free account at https://dash.cloudflare.com/sign-up.
2. On any computer with Node.js:

   ```sh
   cd relay
   npx wrangler login
   npx wrangler deploy
   ```

   Wrangler prints your relay's address, such as `https://reader-relay.<you>.workers.dev`.

   No computer handy? In the Cloudflare dashboard go to **Workers & Pages →
   Create → Create Worker**, paste the contents of `worker.js`, and click **Deploy**.

3. In Read Free, open **Settings → Downloads → Download relay**, paste the address,
   tap **Save**, then **Test**.

## Lock it to your own site (optional)

Set `ALLOWED_ORIGINS` in `wrangler.toml`, for example
`ALLOWED_ORIGINS = "https://laroccaconsulting.github.io"`, and deploy again.
Then only your own site can use the relay.
