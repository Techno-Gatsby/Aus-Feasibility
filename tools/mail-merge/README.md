# Gmail mail merge (Google Sheets + Apps Script)

`Code.gs` sends one personalised Gmail per row of a Google Sheet. The template is an
ordinary Gmail draft with `{{Column Name}}` placeholders, so its formatting, links,
pasted images and attachments all carry over. You run everything from a **Mail merge**
menu in the sheet.

## Set up (once per spreadsheet)

1. **Put your list in a Google Sheet.** Put the column headings in row 1 and one person
   per row below. The only column you must have is **Email**. To try it out first, use
   **File → Import → Upload** with `example/recipients.csv`.
2. **Add the script.** In the sheet, go to **Extensions → Apps Script**. Delete what's in
   `Code.gs`, paste in the contents of [`Code.gs`](Code.gs) from this folder, and click
   **Save** (the disk icon).
3. **Reload the spreadsheet.** After a few seconds a **Mail merge** menu appears to the
   right of **Help**.
4. **Allow access the first time.** The first time you use the menu, Google asks for
   permission to use your Gmail, Drive and Sheets. Because the script is yours rather
   than a published app, Google shows *"Google hasn't verified this app"*. Click
   **Advanced → Go to *(project name)* (unsafe) → Allow**. The script only runs in your
   account.

## Write the template

In Gmail, start a new email but leave the recipients empty. Write the subject and body,
and wherever a value from the sheet belongs, put the column heading in double braces.
Then just close it. It stays in **Drafts**.

> **Subject:** {{Project}}: builder briefing on {{Briefing Date}}
>
> Hi {{First Name}},
>
> Thanks for your interest in **{{Project}}**. Lots for {{Company}} are currently priced
> from **{{Lot Price}}**.
>
> We're holding a builder briefing on {{Briefing Date}}. Just reply to confirm.

- **Values appear exactly as the sheet displays them.** Format the cells the way you want
  them in the email, for example currency as `$485,000` or dates as `14/11/2026`.
- **Placeholder names are forgiving.** Capitals and spaces don't have to match, so
  `{{first name}}` and `{{FirstName}}` both fill from **First Name**.
- **Everything in the draft goes to everyone.** Bold text, links, images pasted into the
  body and attached files are all included. The draft's own To/CC fields are ignored.
- **Add your signature to the draft itself.** Gmail doesn't add it to emails a script
  sends.
- **Don't send the template draft.** Once it's sent, the script can't find it any more.

## Columns

| Column | What it does |
|---|---|
| **Email** | Who it goes to. To send to several people, separate the addresses with `,` or `;`. Can also be named *Email Address* or *To*. |
| **CC**, **BCC** | Optional, per row. |
| **Attachments** | Optional, per row. Google Drive links or file IDs, separated by `,` or `;`. Google Docs, Sheets and Slides are attached as PDFs. |
| **Email Sent** | Added by the script. It records `Sent 2026-10-09 10:30` (or the error) for each row. |

Any other column can be used as a placeholder.

## Send

Everything is in the **Mail merge** menu, and it always works on the sheet tab you have
open.

1. **Choose template draft…** lists up to 15 of your drafts. Type the template's number,
   or its exact subject if it isn't in the list. The sheet remembers your choice, so you
   only do this once.
2. **Preview selected row**: click any row, then choose this to see that person's email
   exactly as it will look.
3. **Send test emails to me** sends the first 3 rows to your own address. Each subject
   starts with `[TEST for jane@example.com]` so you can see who it was meant for. Nothing
   is marked as sent.
4. **Send emails** tells you how many emails it's about to send, and from which address.
   Click **Yes** and it sends them, filling in **Email Sent** as it goes.

You can also choose **Create Gmail drafts** to put every email in your Drafts folder and
send them yourself.

## Before anything is sent

The script checks every row first. If any of these come up, it lists the problem rows and
sends nothing:

- a placeholder names a column that doesn't exist
- a placeholder's cell is empty
- an address doesn't look valid
- a Drive attachment can't be opened

Nobody gets "Hi ," or a stray `{{First Name}}`. To leave the bad rows out instead of
stopping, set `SKIP_INVALID_ROWS: true` (see Settings).

## Re-running, filters and limits

- **Re-running is safe.** Rows already marked **Sent** are skipped, so if a run stops
  partway, choose **Send emails** again and it picks up where it left off. Clear a row's
  **Email Sent** cell to send to that person again. Rows marked **Error** are retried
  automatically.
- **Filters work.** If the sheet has a filter on, only the visible rows are sent.
- **Gmail has a daily limit** on emails sent by scripts: about **100 recipients a day**
  for a free Gmail account and **1,500** for Google Workspace. CC and BCC addresses count
  too. The script checks your remaining allowance, sends up to it, then tells you to run
  again tomorrow for the rest.
- **One run lasts about 5 minutes**, enough for a few hundred emails. Google stops
  scripts after 6 minutes, so the script pauses just before that and tells you how many
  are left. Choose **Send emails** again to carry on.

## Settings

At the top of `Code.gs`:

| Setting | Default | What it does |
|---|---|---|
| `SENDER_NAME` | blank | The name recipients see, e.g. `'Riverside Estate Sales'`. Blank uses your Gmail name. |
| `FROM` | blank | Send from another address. It must already be set up in Gmail under **Settings → Accounts → Send mail as**. |
| `REPLY_TO` | blank | Where replies should go. |
| `TEST_ROWS` | `3` | How many rows **Send test emails to me** sends. |
| `ALLOW_BLANK` | `false` | Set to `true` to allow empty cells in placeholders. |
| `SKIP_INVALID_ROWS` | `false` | Set to `true` to skip rows with problems instead of stopping. |
| `SKIP_FILTERED_ROWS` | `true` | Leave out rows hidden by a filter. |
| `STATUS_COLUMN` | `Email Sent` | The heading of the column the script records sends in. |
