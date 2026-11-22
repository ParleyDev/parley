# Reporting to the authorities

> **Draft for the instance owner to review with a lawyer before relying on it.** This page is guidance written by
> the Parley project, not legal advice, and it has not been checked against current law in any country. Laws in
> this area differ by country and change often.

When you run a Parley instance, you are the provider of that service. The Parley project is not: it distributes
software, holds none of your members' data and cannot see your instance. So the duties a provider has when it
finds child sexual abuse material on its service, where they exist, fall on you.

## What you may be required to do

Find out what applies where you and your members are. Typical duties, where they exist:

- **Report** apparent child sexual abuse material once you become aware of it, to a named body and within a set
  time.
- **Preserve** what you hold about it (the file, who uploaded it, from where, when) for a set period, and not
  destroy it.
- **Not distribute or view it further** than the report requires. Do not download it, forward it or show it to
  colleagues. In most places possessing it is itself an offence, with narrow exceptions for reporting.
- **Not tell** the person who uploaded it that a report was made.

Starting points to look up, not a complete list:

| Where | Body |
|---|---|
| United States | NCMEC's CyberTipline. Providers register to file. |
| Canada | Cybertip.ca (the Canadian Centre for Child Protection), and the police. |
| United Kingdom | The Internet Watch Foundation, and the National Crime Agency. |
| European Union | Your country's hotline in the INHOPE network, and the police. |
| Elsewhere | The INHOPE member hotline for your country, or the police. |

Register with the body you would report to **before** you need it. Registration can take time, and a deadline can
start the moment you become aware.

## What Parley does

- **Finds known material on upload**, if you set up [known-material matching](media-matching.md). A match is
  refused, the file is quarantined where nothing serves it, the account is suspended, and a record appears under
  **Admin Console → Matched Uploads**, on legal hold.
- **Takes a snapshot when something is reported**: the message, what was said around it, the profile, and a copy
  of the files. It survives the message being deleted. See **What was kept** on a report.
- **Will not let a child-safety report be closed without a decision on record.** A report about sexual content
  involving a child, or about an adult pursuing a child, cannot be resolved or dismissed until a trust-and-safety
  lead or legal records either:
  - the report that was filed: with whom, the reference they gave, the date, and a confirmation that the evidence
    is preserved (which puts the report on legal hold, so nothing is cleared); or
  - that no report was needed, and why.
- **Gives you the details a report form asks for**, in one file: **Details for the report**, on the report and on
  a matched upload. It contains what happened and when, who it is about (username, email, when they registered,
  the network addresses they connected from with dates), who reported it, the words reported, and the name, size
  and SHA-256 of each file with where the held copy is on your server. It never contains a file.
- **Logs everything**: who looked, who recorded what, and every export.

## What Parley does not do

- It does not file a report for you, and it does not decide whether one is required.
- It does not open or classify the files. Whether something is what a reporter says is your call, made without
  looking more than you must.
- It cannot see calls or screen shares, or the content of end-to-end encrypted calls.
- It does not keep evidence forever by default. A report's snapshot is cleared `REPORT_RETENTION_DAYS` after the
  report is closed (default 365) unless it is on legal hold. Set this to at least the preservation period that
  applies to you.

## Doing it

1. A report marked **Urgent** arrives, or a match appears under **Matched Uploads**. Handle these first.
2. Do not open the file. Read the record.
3. Click **Details for the report** and keep the file somewhere only the people who must see it can reach.
4. File the report with the body that applies to you, using those details. Follow their instructions about the
   file itself.
5. Record it: on a report, tick **A report was filed**, enter where, the reference and the date, and confirm the
   evidence is preserved. On a matched upload, enter the reference under **Record the report**.
6. Then close the report or the match. Leave the legal hold on until you are sure nothing requires the evidence.
7. Act on the account (suspend, or a hard ban under **Bans & Limits**) as your rules say. Do not tell the person
   why if the law where you are forbids it.

Back up `UPLOAD_DIR/quarantine` and `UPLOAD_DIR/evidence` with the rest of your uploads, and restrict who can read
the backups.
