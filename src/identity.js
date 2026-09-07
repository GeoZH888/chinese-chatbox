/* How an item is identified, everywhere.

   Progress is keyed by what is being practised — language plus content — not by
   where it sits in this app's curriculum. Reordering a unit therefore cannot
   reset anyone's progress, and 你好 practised in another app on the shared
   Supabase platform is the same item as 你好 here.

   public.normalize_content() in supabase/schema.sql does the same job on the
   server, and the server is the authority: it recomputes identity for every row
   it stores. This copy exists so the offline tutor can key its local progress
   the same way with no network. */
(function (global) {
  'use strict';

  // Punctuation, spacing and case carry no meaning for "which phrase is this".
  const NOISE = /[\s，。、？！；：""''「」《》…·【】,.?!;:"'()（）\-—_/～~]/g;

  function normalize(text) {
    return String(text == null ? '' : text).toLowerCase().replace(NOISE, '');
  }

  // 'zh|phrase|你好'
  function key(lang, kind, content) {
    return lang + '|' + kind + '|' + normalize(content);
  }

  global.IDENTITY = { normalize: normalize, key: key };
})(typeof window !== 'undefined' ? window : globalThis);
