-- WhatsApp-style read receipts (tick progression).
-- Lets a RECIPIENT (thread member who is not the sender) update a message's
-- status: 'sent' → 'delivered' when their app fetches it, → 'read' when they
-- open the conversation. Senders then see ✓ / ✓✓ / blue ✓✓ progress live.
--
-- Run this once in the Supabase SQL editor. Safe to re-run (idempotent).

drop policy if exists chat_messages_update_status on public.chat_messages;
create policy chat_messages_update_status
  on public.chat_messages
  for update
  using (
    public.is_thread_member(thread_id, auth.uid())
    and sender_id <> auth.uid()
  )
  with check (
    public.is_thread_member(thread_id, auth.uid())
    and sender_id <> auth.uid()
  );
