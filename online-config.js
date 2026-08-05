/* Fuvarszervező V44.2 – online kapcsolat.
   1) Hozz létre egy Supabase projektet.
   2) Futtasd le a supabase/schema.sql fájlt.
   3) Másold ide a Project URL és Publishable/anon key értékét.
   A secret/service_role kulcs SOHA nem kerülhet ebbe a fájlba vagy GitHubra. */
window.FUVARSZERVEZO_ONLINE_CONFIG = {
  supabaseUrl: 'https://YOUR-PROJECT.supabase.co',
  anonKey: 'YOUR-PUBLISHABLE-OR-ANON-KEY',
  pollIntervalMs: 15000,
  deliveryEmailDefault: 'szabo.sandor@stand98'
};
