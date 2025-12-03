alter table public.members drop column if exists info;

alter table public.members drop column if exists nicknames;

alter table public.members add column if not exists image_file_hash text;


