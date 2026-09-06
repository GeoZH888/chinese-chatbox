/* Deployment configuration.

   Leave these empty and the app behaves exactly as it does offline: no accounts,
   no sync, progress in this browser only. Fill them in to enable Supabase
   sign-in (which also unlocks the hosted AI tutor on Netlify).

   The anon key is designed to be public — row level security in
   supabase/schema.sql is what protects the data, not the secrecy of this key.
   Never put the service_role key here. */
(function (g) {
  'use strict';

  g.CHATBOX_CONFIG = {
    SUPABASE_URL: '',      // e.g. 'https://abcdefgh.supabase.co'
    SUPABASE_ANON_KEY: ''  // the project's anon / publishable key
  };
})(typeof window !== 'undefined' ? window : globalThis);
