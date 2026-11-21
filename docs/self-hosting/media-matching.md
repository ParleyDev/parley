# Matching uploads against known abuse material

Parley can check every upload against known child sexual abuse material before anyone can see it. It ships the
plumbing: the check on every upload, quarantine, suspension of the account, and a review queue. It does not ship
the lists. Those are only given to vetted organisations, so each operator connects the source they are entitled to.

This page is for whoever runs a Parley instance. It is guidance, not legal advice. When you run an instance you are
the provider of that service, and in many countries a provider who becomes aware of this material has duties to
report it and to preserve what they hold. Find out what applies to you before you open registration to the public.

## What happens to an upload

Every path that stores media runs the check before the file can be served: attachments, voice messages, profile
pictures, banners, server icons, emoji, stickers and soundboard sounds.

1. The file's SHA-256 is looked up in your hash lists.
2. If it is a picture or a video and a matching service is set, the file is sent to that service.
3. On a match:
   - the upload is refused with "This file can't be uploaded." Nothing tells the sender what was recognised;
   - the file is written to `UPLOAD_DIR/quarantine/<match id>` with owner-only permissions. No route serves that
     folder. It is evidence: do not open, copy or move it except as your law and the authority direct;
   - the account is suspended (administrators are not suspended by a machine; the match is still recorded);
   - a record goes to **Admin Console → Matched Uploads**: who, when, from which address, where it was headed, and
     what matched. The record is put on legal hold.

Back up the quarantine folder with the rest of `UPLOAD_DIR`, and restrict who can read your backups.

## Setting it up

**Admin Console → Known-Material Matching** (instance managers only).

### A matching service

A hash list only catches byte-identical copies. Services such as Microsoft's PhotoDNA Cloud Service, Thorn's Safer
and the hash-sharing programmes of NCMEC and the Internet Watch Foundation recognise re-encoded and resized copies,
and each has its own application process and API. Parley does not talk to any of them directly. You run a small
adapter that speaks the contract below on one side and your service's API on the other, and give Parley its
address.

Parley sends one request per picture or video:

```
POST <service address>
Authorization: Bearer <access token>      (only when a token is set)
Content-Type: <the file's type, e.g. image/jpeg>
X-Parley-Sha256: <hex SHA-256 of the file>
X-Parley-Surface: attachment | image | sound | test

<the file's bytes>
```

The adapter answers `200` with JSON:

```json
{ "match": false }
```

or, for a match:

```json
{ "match": true, "source": "name of the service or list", "reference": "its id for this match", "category": "optional" }
```

`source`, `reference` and `category` are shown to the reviewer and are optional. Any other status, a timeout
(20 seconds) or an unreadable answer counts as the service being unavailable.

Rules for the adapter:

- It must not keep the files it is sent, or log their content.
- It should be reachable only from the Parley backend (a private network, or a token).
- **Send a test picture** in the console posts a single blank pixel with `X-Parley-Surface: test`. Answer
  `{ "match": false }` to it.

**Refuse uploads when the service cannot be reached** decides what an outage means. Off: pictures and video go
through unchecked while the service is down. On: they are refused until it is back. Hash lists are checked either way.

### Hash lists

Paste SHA-256 values (64 hex characters each, one per line; other separators are fine) and give the list a name,
which is shown with any match it produces. Up to 200,000 values at a time. Removing a list by name removes all of
its values. The values are not written to the audit log, only how many were added and to which list.

## Reviewing a match

**Admin Console → Matched Uploads** is open to trust-and-safety leads and legal only, and every look is logged. It
shows the record and never the file.

- **Record the report**: once you have filed the report your law requires (in the United States, with NCMEC's
  CyberTipline), enter the reference you were given. The match becomes *Reported*.
- **Release as a false match**: needs a note saying why, and the legal hold lifted first. It restores the account
  (if this match suspended it) and destroys the quarantined file.
- **Close**: after a report is recorded.
- **Legal hold** is on from the start. Lift it only when you are sure nothing requires the file to be kept;
  **Destroy the quarantined file** is offered once a match is closed and not on hold.

## What this does not do

- It does not file reports for you. That step is yours.
- It does not look for new, unknown material, grooming, or nudity in general. See the explicit-image filter and
  reports for those.
- Calls and screen shares are not checked, and end-to-end encrypted calls cannot be.
- It is off until you set it up. An instance with no list and no service checks nothing.
