-- Suppression du compte depuis le jeu (exigée par Google Play pour toute app
-- qui crée des comptes, en plus de la page web site/delete-account.html).
--
-- Effacer la ligne de `auth.users` emporte tout par cascade : `profiles`, puis
-- tout ce qui pointe vers `profiles` avec `on delete cascade` — progression,
-- scores, classements, grilles proposées, transactions.
--
-- Trois liens n'ont pas de cascade et bloqueraient la suppression :
--   - `community_levels.moderated_by`, `daily_puzzles.selected_by_admin` (un
--     compte de modération) : remis à null ;
--   - `daily_puzzles.community_level_id` (une grille du joueur passée en
--     puzzle du jour) : la contrainte `daily_puzzles_source_check` interdit de
--     le mettre à null, la ligne du jour est donc effacée avec la grille. Si
--     c'était la grille d'aujourd'hui, le prochain appel de
--     `daily_community_level` en choisit une autre.
--
-- Anonymes compris : un compte anonyme est un vrai compte côté serveur.

create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = public, auth
as $fn$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception 'not signed in';
  end if;

  update public.community_levels set moderated_by = null where moderated_by = v_user_id;
  update public.daily_puzzles set selected_by_admin = null where selected_by_admin = v_user_id;
  delete from public.daily_puzzles
    where community_level_id in (select id from public.community_levels where creator_id = v_user_id);

  delete from auth.users where id = v_user_id;
end;
$fn$;

revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;
