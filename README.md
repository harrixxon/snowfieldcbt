# Exam Flow

CBT (Computer-Based Testing) Platform — Lovable Build Prompt

Overview

Build a Computer-Based Testing (CBT) web application for a secondary school with three roles: Admin, Teacher, and Student. The system must support up to 300 students taking exams, with randomized question order per student and a server-authoritative timer (the countdown must be tracked on the backend, not just in the browser, so students can't cheat by editing client-side JavaScript or refreshing the page).

Tech Stack

Frontend: React + TypeScript + Tailwind CSS

Backend/Database: Supabase (PostgreSQL) with Row Level Security (RLS)

Server logic (timer validation, exam locking, grading): Supabase Edge Functions

Auth: Supabase Auth for Admin/Teacher (email + password). Students authenticate via a custom lookup (roll number + exam code) — NOT Supabase Auth email flow.

Roles & Permissions

1. Admin

Create/manage teacher accounts (name, subject, email, password)

Create/manage classes (e.g., JSS1, JSS2, SS1, SS2, SS3) and subjects

Create/manage student records: full name, roll number (auto-generated, unique), class

View all exams created by all teachers (read-only)

View exam results/analytics across the whole school (per class, per subject, per student)

Generate/regenerate exam access codes

Suspend/reactivate a student's ability to take an exam (e.g., if they need a retake)

2. Teacher

Log in with email/password

Create a question bank per subject: each question has question text, 4 options (A–D), correct answer, and optional mark value (default 1)

Create an exam: select subject, class, set number of questions to pull from the bank, set duration in minutes, set start time and end time window, generate a unique exam code

Submit the exam to make it live (no admin approval step — submission = live, once within the start/end window)

View results for exams they created: per-student score, time taken, list of correct/incorrect answers

Edit/deactivate an exam only before its start time; once live, it is locked

3. Student

Log in using roll number + exam code (no password/account creation)

On login, sees a pre-exam screen: subject, duration, number of questions, instructions, and a "Start Exam" button

Once started, sees ONE question at a time with a persistent countdown timer

Question order AND answer option order (A–D) are randomized per student, but fixed for the duration of that student's attempt

Can navigate between questions (next/previous) and flag questions for review before final submit

Auto-submit when time expires (server-triggered, not just client-side)

Cannot re-enter a completed exam

Sees a "Submitted" confirmation screen after finishing (no score shown unless admin/teacher enables it)

Critical Technical Requirements (do not skip these)

Randomization must be attempt-scoped, not request-scoped

When a student starts an exam, generate the randomized question order (and option order) ONCE and store it as a snapshot tied to that student's attempt_id. Do NOT re-randomize on every page load/refresh — this breaks review/flag functionality and lets students see the same question twice with different option letters. Store this snapshot in a table like exam_attempts with a JSON column for question order and option mapping.

Server-authoritative timer

On exam start, record started_at timestamp server-side.

Calculate expires_at = started_at + duration_minutes server-side.

The frontend countdown is cosmetic — it should be recalculated from expires_at on every load, not trusted from local state.

An Edge Function (or scheduled check) must auto-submit any attempt where now() > expires_at and submitted_at IS NULL.

Reject any answer-submission request that arrives after expires_at.

Prevent duplicate/concurrent attempts

A student can only have ONE active attempt per exam. If they close the tab and log back in with the same roll number + exam code while expires_at hasn't passed, resume the SAME attempt (same question order, remaining time) — do not start a fresh one.

Once submitted_at is set, block re-entry entirely and show "You have already submitted this exam."

Basic anti-cheating (best-effort, not bulletproof — be upfront about this in the UI, not a false promise)

Disable copy-paste and right-click on the exam question screen

Log tab-switch/window-blur events with a timestamp (visible to teacher/admin in results, not auto-disqualifying)

Optional fullscreen prompt before starting

Data Model (suggested tables)

admins (linked to Supabase auth.users)

teachers (linked to Supabase auth.users, subject, name)

students (roll_number, full_name, class, unique constraint on roll_number)

subjects (name, class)

questions (subject_id, teacher_id, question_text, option_a–d, correct_option, marks)

exams (teacher_id, subject_id, class, exam_code UNIQUE, num_questions, duration_minutes, start_time, end_time, is_active)

exam_attempts (student_id, exam_id, question_order JSON, option_order JSON, started_at, expires_at, submitted_at, score)

attempt_answers (attempt_id, question_id, selected_option, is_correct)

Design/UX Notes

Clean, distraction-free exam-taking screen — no navigation bars, no exit links except a clearly-labeled "Submit Exam" button with a confirmation modal.

Mobile-responsive, since some students may test on phones/tablets, but optimize primarily for desktop/lab computers since that's the actual test environment.

Admin and Teacher dashboards should use simple cards/tables — prioritize clarity for non-technical staff over visual flourish.

Scale Note

Expect ~300 students, potentially many taking the same exam concurrently within the same start/end window. Design queries with proper indexing on roll_number, exam_code, and exam_id to avoid slow lookups during peak login (e.g., first 5 minutes of an exam window when everyone logs in at once).

This project was built with [Lovable](https://lovable.dev).

**Live app**: https://snowfieldcbt.lovable.app

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/123f045d-575b-4539-98ae-b4ec3a9c3741).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
