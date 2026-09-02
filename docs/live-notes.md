# Taking notes in a meeting nobody recorded

Status: LN-1..3 built 2026-08-30. Tests green, not live-verified in the app.
Two proposals were rejected and are written down at the bottom so they do not
come back.

Three things came out differently from the plan below:

- **An all-day entry is never live.** It runs midnight to midnight, so an
  offsite, a holiday or a block of leave read as a call in progress for the
  whole day and took the Home row from the 14:00 meeting under it. The clock
  test lives in `isLiveWindow`, once, so the page and Home cannot disagree.
- **One parser for the window.** The note page worked out its own start with
  `Date.parse`, which reads a bare date as UTC and can shift a meeting across
  midnight. `meetingWindow` now answers both, and `isUnreadMeeting` moved beside
  it so the LN-3 rule can be tested without rendering the page.
- **The cursor lands at the end of the seeded heading**, not on the line under
  it. `registerFocus` only exposes `focus('end')`, and ProseMirror resolves that
  backwards into the heading when the heading is the last node. One Enter fixes
  it. Placing it properly needs a new editor command.

## The rule

Notes belong in the meeting they came from.

The format decided this long ago. `defaults.ts` states the meeting file as the
single anchor for the whole lifecycle: `## Prep` before, `## Notes` during,
`## Summary` once processed. `propose_meeting` leaves `## Notes` empty above the
summary "for the PM". The UI never carried it out.

The reason is what happens after. The meeting file already carries the date, the
participants, the customer and the series, so notes written there are filed the
moment they are typed. Notes written anywhere else have to be attached later by a
model that was not in the room, and a wrong attach puts the PM's words in the
wrong customer's history.

There is a second cost and it is a live bug. Notes kept outside the meeting leave
the meeting empty, so `needsCapture` asks the PM to fill in a meeting they did
write up.

## What is broken today

1. **No door while the meeting runs.** The prep offer shows only while the start
   is in the future (`NoteView.tsx:321`). The empty-meeting block shows only an
   hour after the end (`CAPTURE_GRACE_MS`, `note-status.ts:97`). Between the two
   the page is machine frontmatter and a blank editor, with nothing that says
   this is where the notes go.
2. **Home drops the meeting when it starts.** The next-meeting row is gated on
   `isUpcomingMeeting` (`attention.ts:247`), so it disappears at the minute it
   becomes useful.
3. **Typed notes are a dead end.** "Go through the transcript" needs a transcript
   (`NoteView.tsx:343`). "Go through this note" needs `type === 'note'`
   (`NoteView.tsx:398`). A meeting the PM wrote by hand gets neither, so the
   notes never become proposals.

## LN-1: the meeting page says it is happening

Add `isLiveMeeting(n, now)` to `note-status.ts`: start is at or before now, end
is after it. `meetingStart` and `meetingEnd` already exist, so this is one
predicate, not new machinery.

While it is true, the meeting page shows one line where the prep offer sits:

> Happening now. [Take notes]

The button seeds `## Notes` if the body has no heading yet, then puts the cursor
under it. `## Prep` stays above, because the brief is what the PM wants on screen
while the call runs.

The prep offer and this line are the same slot and never both show: before the
meeting the PM wants the brief, during it they want the cursor.

**Trap.** `captured` is `hasBody || transcripts`, and `has_body` is
`body.trim().length > 0` (`sqlite-index.ts`). Seeding `## Notes` when the page
opens would mark every live meeting captured and silence the nudge on meetings
nobody wrote in. Seed on the click, never on render.

## LN-2: Home keeps the meeting through the meeting

The `meeting` attention item currently needs `isUpcomingMeeting`. Widen it to
upcoming or live. While the meeting runs the row reads:

> Nordkap check-in — now — take notes

It opens the meeting the same way it does now. Ranking does not change: it stays
where the next-meeting row already sits.

## LN-3: typed notes get the same button as a recording

`unreadMeeting` becomes: a past meeting that is not `processed` and holds
contents, where contents means a transcript **or** a non-empty body. The button
reads **Go through this meeting** in both cases. One term for one thing, because
from the PM's side it is one act.

The session seed says which contents it is. Typed notes are authored, not
received, so the run treats them as the PM's own words. Where notes and a
transcript disagree, the notes win: the PM wrote them.

## Rejected

- **A key for "where today's writing goes" (⌘J).** One key that opened the live
  meeting, or today's log when no meeting was on. Rejected with the day log: with
  no log to fall back to, the key only duplicates the Home row and the rail.
- **A first-class day log.** One file per day for what belongs to no meeting,
  with its own row on Home. Rejected. A PM who wants one makes it with ⌘N like
  any other note, and `process-note` already cleans up a growing dump. The
  product does not need to own the idea.

## Open

- **A call that was never in the calendar.** `meeting` is deliberately not
  hand-creatable (`edit-layer.ts:114`: a blank one "has no provenance to stand
  on"), and `propose_meeting` requires a transcript. So an ad-hoc call has
  nowhere meeting-shaped to go. Two ways out: let a meeting be made by hand
  (dated today, never `synced`), or relax `propose_meeting` so a run can propose
  the page from a plain note. Decision: _unfilled_.

## Known edge, not fixed

If the PM types and clicks Take notes inside the 1.5s autosave debounce, the
seed writes against a stale body, the editor's dirty guard refuses it, and the
next autosave drops the heading. Their words survive, the heading does not.
Flushing first needs a body ref above the early returns in `NoteView`, which is
more machinery than the button is worth.

## Where it landed

- `note-status.ts`: `meetingWindow`, `meetingWindowOf`, `isLiveWindow`,
  `isLiveMeeting`, `isUnreadMeeting`. `meetingStart` and `meetingEnd` are
  unchanged in behaviour and pinned by tests.
- `attention.ts`: the meeting row's window and its live wording.
- `NoteView.tsx`: the now line, `takeNotes`, the one "Go through this meeting"
  button.
- `agent-nudges.ts`: `readMeetingSeed(path, contents)`.
- `test/live-meeting.test.ts` (new) and `test/attention.test.ts`.
