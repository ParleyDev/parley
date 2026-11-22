# Requests from the police and courts, and takedown notices (process note)

> An internal note for the people who run an instance. A starting point, not legal advice: the rules for what you
> must hand over, to whom and how fast depend on where you are. Decide your own process with someone who knows
> them, before the first request arrives.

## Before anything arrives

- Publish one contact for these requests (**Admin Console → Policies & Contacts → Lawful requests and takedown
  notices**) and make sure someone reads it.
- Decide who may answer. In Parley that is the **Legal** admin role: it can see account details in full, export
  under a case, and put evidence on legal hold. Give it to as few people as you can.
- Know what you hold. Parley keeps: account details (username, email, when registered), the network addresses an
  account signed in from (for `NETWORK_LOG_DAYS`), messages and files until they are deleted, and reports with
  their evidence. It cannot read end-to-end encrypted calls, and it does not record calls.

## When a request arrives

1. **Check it is real.** Who is it from, and does it come from where that body's requests come from? Reply to an
   address you looked up yourself, not the one in the message. A request by phone, or from a personal address, is
   not one until it is confirmed.
2. **Check what it is.** A court order or a warrant addressed to you, in a country whose courts have authority over
   you, is different from an informal ask. Note what exactly it asks for and under what law. If you are not sure
   it binds you, ask your lawyer before answering.
3. **Preserve first.** If it asks you to keep data, or if deleting would defeat it, put the relevant report or
   matched upload on **legal hold** and do not delete the account. Preserving is not handing over.
4. **Hand over only what it asks for, and no more.** Open a case in the Admin Console for it, so that every look
   and every export is tied to the request and logged. Use the case's export.
5. **An emergency** (someone's life is at risk right now): many laws let you disclose what is needed to prevent
   it without an order. Call the police yourself if you believe someone is in immediate danger. Write down what
   you did and why.
6. **Telling the person.** Tell the account holder about a request for their data unless the order, or the law,
   forbids it, or it would put someone at risk.
7. **Write it down**: who asked, when, under what authority, what you gave, who decided. Keep the request itself.

Child sexual abuse material is a separate matter with its own duties: see
[reporting to the authorities](../self-hosting/reporting-to-authorities.md).

## Takedown notices

For a claim that something on your instance breaks the law or someone's rights (copyright, defamation, a
court-ordered removal):

1. Check the notice says what the content is, where it is (a link), who is complaining and on what basis. Ask for
   what is missing.
2. Look at the content. If the claim is plainly right, remove it (**Reports**, or delete the message from the
   console). If it is plainly wrong, say so and leave it. If you cannot tell, get advice; some laws protect you
   only if you act quickly once you know.
3. Tell the person who posted it what was removed and why, and how to object, unless you are forbidden to.
4. Keep the notice and what you did.

If your country has a formal procedure for this (a registered agent, set time limits, a counter-notice), follow
that procedure and not this note.
