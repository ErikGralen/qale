---
type: skill
title: How you write tickets
summary: How Qale drafts tickets and comments so they read like yours.
---

Qale reads this before it drafts a ticket or a comment. It is a guess from your own tickets, not a
rule you gave it. Change any line and it drafts the new way from the next ticket on.

Read from your last thirty tickets in PAY on 2026-07-10. A guess from your tickets, not a rule you
gave me. Change any line and I draft the new way from the next ticket on.

## When you draft a ticket

- File it in PAY. It is the only project this team works in.
- A story says what a customer cannot do today in one sentence, then acceptance criteria as a
  checklist of three (PAY-142). A bug gets the steps and the app version (PAY-131).
- The title names the outcome, not the work: "Admins can require SSO for a workspace" (PAY-142).
- If the work comes from one customer, name them in the first line of the description.
- Assignee stays empty until estimation. Parent is the epic when there is one. Priority and
  components stay empty.

## Labels

- `enterprise-auth`: SSO, SCIM and audit work. 14 of 30 tickets.
- `reporting`: the exports and the dashboard. 9 of 30.
- `reliability`: incidents and the fixes that follow them. 7 of 30.
- One area label per ticket, never two.

## When you comment

- Say what changed and what happens next. The ticket already says what the work is.
- Put a date on anything that is expected, and name who owes it.

## Standing instructions

Rules you asked for in a chat land here.

- Keep acceptance criteria to three checkboxes. If it needs more, it is two tickets.
