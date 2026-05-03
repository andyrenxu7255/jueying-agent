create extension if not exists pgcrypto;
create extension if not exists vector;
create extension if not exists pg_trgm;

do $$
begin
  create extension if not exists age;
exception
  when undefined_file then
    raise notice 'AGE extension is not available in this image yet';
end $$;
