-- Réglages de l'app lus par tous les clients, à commencer par la version
-- minimale (demande du 2026-11-23 : pouvoir pousser une mise à jour).
--
-- `min_version_code` : un client Android dont le versionCode est plus petit
-- voit l'écran « Mise à jour requise » (src/native/update.js). 0 : personne.
-- Pour forcer, dans le SQL editor :
--   update public.app_config set value = '14' where key = 'min_version_code';
--
-- Lecture publique (anonymes compris : l'écran doit pouvoir bloquer avant la
-- connexion), écriture réservée au SQL editor — aucune politique d'écriture.

create table if not exists public.app_config (
  key text primary key,
  value jsonb not null
);

alter table public.app_config enable row level security;

drop policy if exists app_config_read on public.app_config;
create policy app_config_read on public.app_config
  for select to anon, authenticated using (true);

insert into public.app_config (key, value) values ('min_version_code', '0')
on conflict (key) do nothing;
