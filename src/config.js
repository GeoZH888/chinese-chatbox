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
    SUPABASE_URL: 'https://yqcojudvvjntaajnrilr.supabase.co', // e.g. 'https://abcdefgh.supabase.co'
    SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlxY29qdWR2dmpudGFham5yaWxyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUzNDkxNzQsImV4cCI6MjA5MDkyNTE3NH0.pJuxsTRieYTnZtEysOLcPfUZ9Map0z74o2lKtc8uGAk' // the project's anon / publishable key
  };
})(typeof window !== 'undefined' ? window : globalThis);
