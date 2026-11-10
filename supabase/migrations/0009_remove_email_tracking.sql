-- Email tracking is gone: no forwarding address, no Postmark, no Gmail connection.
-- The extension now catches applications on the page and keeps reminders itself.
-- This drops everything 0006, 0007 and 0008 made, including the stored email text and any Gmail tokens.
-- Run it in the Supabase SQL editor after deploying the version without email tracking.

drop table if exists public.email_texts;
drop table if exists public.email_events;
drop table if exists public.email_inboxes;
drop table if exists public.gmail_connections;
