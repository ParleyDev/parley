---
title: Getting started
section: Getting started
order: 10
summary: Create an account, sign in on any device, and pick the Parley app that suits you.
covers:
  - frontend/src/pages/Auth.tsx
  - frontend/src/pages/Try.tsx
  - frontend/src/pages/Verify.tsx
  - frontend/src/pages/PasswordReset.tsx
  - frontend/src/pages/QrApprove.tsx
  - frontend/src/pages/DeleteAccount.tsx
  - frontend/src/components/QrLogin.tsx
  - frontend/src/components/AccountSwitcher.tsx
  - frontend/src/components/GuestBanner.tsx
  - frontend/src/components/VerifyBanner.tsx
  - frontend/src/components/UpdateBanner.tsx
  - frontend/src/components/TitleBar.tsx
  - frontend/src/components/DeleteAccountFlow.tsx
  - frontend/src/components/modals/ClaimGuest.tsx
  - frontend/src/components/modals/settings/DeleteAccountSection.tsx
---

Parley is a place to talk with friends and communities: text chat, voice and video calls, live stages and a music studio. Everything is free for everyone.

## Try it without an account

Want a look first? Open [app.runparley.com/try](https://app.runparley.com/try), or click **Try it without an account** on the login page. You get a guest pass straight into a demo server.

A guest account is removed an hour after you leave. To keep it, click **Sign up to keep it** in the banner. Your messages, profile and servers come with you.

## Creating an account

1. Go to [app.runparley.com/register](https://app.runparley.com/register).
2. Enter your email and choose a **username**: 2 to 32 letters, numbers, `_` or `.`. People can find you by it.
3. Optionally add a **display name**. This is the name people see, and it can have spaces and capitals.
4. Choose a password of at least 8 characters, then click **Continue**.

Parley emails you a link to verify your address. Until you click it, you can chat, but you can't create servers or use Discover. If the email didn't arrive, use **Resend** in the banner at the top of the app.

## Signing in

You can sign in with any of these:

- **Email or username and password.**
- **A passkey**: your fingerprint, face or device PIN, with no password to type. Add one in **User Settings → Account**.
- **A QR code.** On a computer, the login page shows a code. Scan it with a phone where you're already signed in, and confirm with **Yes, log in**.

> Heads up: Only scan a Parley login code that you can see on your own screen. Never scan one that someone sent you. That would sign *them* in as you.

If you turned on [two-factor authentication](settings#account), Parley also asks for the 6-digit code from your authenticator app, a backup code, or your security key.

**Forgot your password?** Click **Forgot your password?** on the login page and Parley emails you a link to choose a new one.

**More than one account?** Click your picture, then **Switch Accounts**, to add another and flip between them.

## Getting Parley on your devices

| Where | How |
|---|---|
| **Web browser** | Go to [app.runparley.com](https://app.runparley.com). Nothing to install. You can also add it to your home screen or dock with **Install app** in User Settings. |
| **Windows, macOS, Linux** | Download the desktop app from [runparley.com](https://runparley.com/#download). It runs in the background, keeps push-to-talk working while you're in a game, and has an in-game overlay. |
| **Android** | Install the app from [runparley.com](https://runparley.com/#download) for push notifications and calls that keep going with the screen off. |
| **iPhone and iPad** | Use [app.runparley.com](https://app.runparley.com) in Safari, and **Add to Home Screen** for notifications. |

The desktop app updates itself. When an update is ready, a green arrow appears; click **Restart to update**.

> Note: Parley is open source, and anyone can run their own Parley server. The apps ask which server to connect to: choose **app.runparley.com**, or type your community's own address. Switch later with **Switch server** in User Settings.

## Next steps

- [Find your way around](finding-your-way) the Parley window.
- [Join a server](joining-servers) or start your own.
- [Set up your profile](profile) so friends recognise you.

## Taking a break, or leaving

In **User Settings → Account**, under **Account Removal**:

- **Disable Account** logs you out everywhere and hides your account. Nothing is deleted. Log in again whenever you like to turn it back on.
- **Delete Account** removes it for good. Before you can delete it, you'll be asked to hand over or delete any servers and apps you own. Then confirm with your password.

After you delete it, you have **14 days** to change your mind: just log in and choose **Restore my account**. After that, your personal details are erased. Your old messages stay where they are, but they're shown as from *Deleted User*.

You can also delete your account from [app.runparley.com/delete-account](https://app.runparley.com/delete-account) without opening the app.
