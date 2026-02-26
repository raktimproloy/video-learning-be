# Live usage and provider selection

The platform supports multiple live-class providers (Agora, 100ms, YouTube, AWS IVS) with **free-minute packages**. The system tracks how many minutes are used per provider, per teacher, and per student, and **automatically selects** a provider when a teacher starts a new live class.

## Behaviour

- **When a teacher starts a live class:** The system picks the **first enabled provider that still has free minutes** (by display order: Agora → 100ms → YouTube). If none have remaining minutes, **AWS IVS** is used as fallback (paid/unlimited).
- **When a live class is in progress:** If a provider’s free minutes run out during the class, **the class is not ended**. The limit is only checked when **starting a new** class.
- **Usage is recorded** when a live session ends (teacher ends without saving, or saves recording). One row per participant: teacher (session duration) and each student (watch time). All stored in `live_usage_records`.

## Database

- **`live_provider_packages`** – Per-provider free minute cap and order (e.g. Agora 10k, 100ms 10k). `is_fallback_only = true` for AWS IVS (used only when others are exhausted).
- **`live_usage_records`** – Per session, per participant: `live_session_id`, `provider`, `user_id`, `role` (teacher/student), `minutes_used`, `session_started_at`, `session_ended_at`.

## Admin APIs

- **GET `/v1/admin/settings/live`** – Live toggles + usage counts (teachers/students/sessions per service). Includes `hundredMsEnabled` for 100ms.
- **PUT `/v1/admin/settings/live`** – Update `liveClassEnabled`, `agoraEnabled`, `hundredMsEnabled`, `awsIvsEnabled`, `youtubeEnabled`.
- **GET `/v1/admin/settings/live-usage/packages`** – List packages with `freeMinutesCap`, `usedMinutes`, `remainingMinutes`, `isFallbackOnly`.
- **PUT `/v1/admin/settings/live-usage/packages/:provider`** – Set `freeMinutesCap` for a provider (body: `{ "freeMinutesCap": 10000 }`).
- **GET `/v1/admin/settings/live-usage/report`** – Full report: `byProvider`, `byTeacher`, `byStudent`, `totalMinutes`, `totalSessions`.

## Env (optional)

- **Agora:** `AGORA_APP_ID`, `AGORA_APP_CERTIFICATE`
- **100ms:** `HM_APP_ACCESS_KEY`, `HM_APP_SECRET`, `HM_TEMPLATE_ID` (stub until SDK integrated)
- **AWS IVS:** `AWS_IVS_STREAM_KEY`, `AWS_IVS_PLAYBACK_URL`, `AWS_IVS_REGION`

When a provider is not configured, the backend still selects it if it has free minutes; the frontend will get 503 when requesting the token until credentials are set.

---

## Teacher course-specific live report

Teachers get an **average live class report** per course.

- **Stored data (already in place):**
  - **live_sessions:** On start we create a row with `started_at`, `course_id`, `lesson_id`, `owner_id`. On stop (end without save or save recording) we set `ended_at` and `status` (discarded/saved).
  - **live_watch_records:** When a student joins we insert `lesson_id`, `student_id`, `joined_at`, `live_session_id`. On leave we set `left_at` and `watch_seconds`. So every join/leave and watch time per student per session is stored.
  - **live_usage_records:** When a session ends we record teacher minutes (session duration) and per-student minutes (from watch_seconds). So total minutes per session and per participant are stored.
  - **view_count on videos:** When the teacher saves a live recording, we set the video’s `view_count` to the number of distinct students who attended that live (attendee count for that session).

- **API:** `GET /v1/courses/:id/teacher/live-report` (teacher only, must own the course). Returns course title, total live sessions, total teacher/student minutes, average students per session, and per-session details: start, end, duration, teacher minutes, student count, student IDs, and attendees (email/id + minutes).

- **Frontend:** Teacher course page has a “Live class report” button that opens `/teacher/courses/[courseId]/live-report` with the full report and session list.
