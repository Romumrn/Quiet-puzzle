-- merge_anonymous_progress avait été créée avec seulement `revoke ... from
-- public` : insuffisant sur ce projet, qui accorde EXECUTE à anon/authenticated
-- par défaut (voir 20260908141408_harden_function_privileges_v2.sql). Détecté
-- via l'advisor sécurité juste après la création de la fonction.
revoke execute on function public.merge_anonymous_progress(uuid) from public, anon, authenticated;
grant execute on function public.merge_anonymous_progress(uuid) to authenticated;
