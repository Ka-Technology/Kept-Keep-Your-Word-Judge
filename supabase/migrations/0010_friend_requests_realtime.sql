-- Live updates for the red dot on Me when a friend request arrives (T22, Supabase Realtime).
-- Inserts and updates reach only people the friendships select policy lets read the row; a delete
-- sends everyone listening just the row's random id.
alter publication supabase_realtime add table public.friendships;
