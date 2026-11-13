# Lunaar site + Chat integration

## Chat route
The chat is available at `/chat` and is linked in the shared navigation.

## Supabase
The browser configuration is in `public/chat/config.js` and points to the existing Supabase project.
The key in that file is a Supabase publishable/anon key (safe for browser use when Row Level Security is enabled).
Never put a Supabase `service_role` key in frontend files.

If you have not already run the chat database setup, open Supabase SQL Editor and run the full contents of `public/chat/schema.sql`. This creates profiles, servers, channels, messages, direct messages, policies, and the signup profile trigger. Enable Realtime for the tables required by the SQL setup if the schema instructions call for it.

For Supabase Authentication, configure the site's deployed URL in Authentication > URL Configuration. For email confirmation, users may need to confirm their email before logging in.

## Vercel
Deploy this project as a Node.js app using the existing `api/index.js` entrypoint. The proxy uses WebSockets and may have hosting-platform limitations; chat itself uses Supabase Realtime.
If you use the AI endpoint, add `GROQ_API_KEY` as a Vercel environment variable. No API secret is hardcoded in the source.
