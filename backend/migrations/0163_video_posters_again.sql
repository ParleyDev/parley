-- Video posters made so far are garbled (stripes of colour): the image's minimal ffmpeg scaled them down without
-- accurate rounding (see video_thumb.rs). Clearing them lets the start-up backfill make every one again, newest
-- first; until it reaches a video, the client paints the video's own first frame where it can.
UPDATE attachments SET thumb_type = NULL WHERE thumb_type IS NOT NULL AND content_type IN ('video/mp4', 'video/webm', 'video/quicktime');
