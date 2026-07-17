-- Drodo profile polls often omit queen_rank and were nulling users.queen_ladder_rank
-- while leaving queen_ladder_last_seen_at set. In-game ladder captures clear rank
-- together with last_seen/season when a player drops off. Preserve rank unless the
-- capture-driven clear path is writing (last_seen also cleared).
create or replace function public.preserve_queen_ladder_rank_on_drodo_null()
returns trigger
language plpgsql
as $$
begin
  if TG_OP = 'UPDATE'
     and NEW.queen_ladder_rank is null
     and OLD.queen_ladder_rank is not null
     and NEW.queen_ladder_last_seen_at is not distinct from OLD.queen_ladder_last_seen_at
     and NEW.queen_ladder_last_seen_at is not null
  then
    NEW.queen_ladder_rank := OLD.queen_ladder_rank;
  end if;
  return NEW;
end;
$$;

drop trigger if exists trg_preserve_queen_ladder_rank on public.users;
create trigger trg_preserve_queen_ladder_rank
  before update on public.users
  for each row
  execute function public.preserve_queen_ladder_rank_on_drodo_null();
