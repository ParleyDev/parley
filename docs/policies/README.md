# Policy templates for people who run a Parley instance

When you open an instance to people you don't know, you are the provider of that service. The documents your
members agree to, the rules of your community and the way people reach you are yours to write and publish. Parley
gives you a place to put them and something to start from.

> These are starting points, not legal advice. Have someone who knows the law where you operate read what you
> publish. Replace everything in `[square brackets]`, and delete what does not apply to you.

| File | What it is |
|---|---|
| [terms.md](terms.md) | Terms of service: what people agree to when they create an account. |
| [community-guidelines.md](community-guidelines.md) | What is not allowed, in plain words, and what happens when it is done anyway. |
| [lawful-requests.md](lawful-requests.md) | An internal process note: how to handle requests from the police and courts, and takedown notices. Not for publishing as it is. |

A privacy notice is not included. What it must say depends on where you and your members are and on what you
actually keep, which only you know. [docs/account-deletion.md](../account-deletion.md) and
[docs/trust-and-safety.md](../trust-and-safety.md) describe what Parley stores and for how long, to draw on.

## Where they show in Parley

Publish the documents anywhere on the web, then enter their addresses under **Admin Console → Policies &
Contacts**:

- **Terms**, **Community guidelines** and **Privacy notice** are linked under the sign-up form ("By creating an
  account you agree to…").
- The **Safety contact** (an email address or a web page) is shown in the report dialog and under **User Settings →
  My Account**, with a link to your guidelines.
- The contact for **lawful requests and takedown notices** is published at `/api/instance/policies`, with the
  rest, for people who need to find it.

A field you leave empty is not shown.
