# Meta (Facebook) Developer App Setup Guide

This guide walks you through creating and configuring a Meta Developer App to enable Instagram content publishing for RestroPulse.

---

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [End-User Requirements](#end-user-requirements)
3. [Create a Meta Developer App](#step-1-create-a-meta-developer-app)
4. [Add Required Products](#step-2-add-required-products)
5. [Configure Facebook Login](#step-3-configure-facebook-login)
6. [Get App Credentials](#step-4-get-app-credentials)
7. [Configure Environment Variables](#step-5-configure-environment-variables)
8. [Add Test Users (Development Mode)](#step-6-add-test-users-development-mode)
9. [Prepare for Production](#step-7-prepare-for-production)
10. [Submit for App Review](#step-8-submit-for-app-review)
11. [Go Live](#step-9-go-live)
12. [Setup Webhooks (Optional)](#step-11-setup-webhooks-optional)
13. [Troubleshooting](#troubleshooting)

---

## Prerequisites

Before starting, ensure you have:

- A personal Facebook account
- A Facebook Page linked to an Instagram Business or Creator account
- Access to the Instagram account you want to connect
- Your RestroPulse backend running (for callback URL)

---

## End-User Requirements

When users connect their Instagram account through RestroPulse, here's what they need:

### Required Before OAuth Flow

| Requirement | Can be done during OAuth? | Notes |
|-------------|---------------------------|-------|
| Instagram Professional Account | No | Must convert to Business or Creator beforehand |
| Facebook Page | Yes | Can create during OAuth flow |
| Link Instagram to Facebook Page | Yes | Handled during OAuth flow |
| Grant permissions | Yes | Handled during OAuth flow |

### How to Convert Instagram to Professional Account

Users must have an Instagram Business or Creator account. To convert:

1. Open the **Instagram mobile app**
2. Go to **Profile** > **Settings** (gear icon)
3. Tap **Account**
4. Tap **Switch to Professional Account**
5. Choose **Business** or **Creator**
6. Follow the prompts (category selection, contact info)
7. Optionally link to a Facebook Page (or do this during RestroPulse OAuth)

**Important**: This is the ONLY step users must complete before connecting their Instagram in RestroPulse. Everything else (Page creation, linking, permissions) is handled automatically during the OAuth flow using Meta's Business Login for Instagram.

---

## Step 1: Create a Meta Developer App

1. Go to [Meta for Developers](https://developers.facebook.com/)
2. Click **Log In** and sign in with your Facebook account
3. Click **My Apps** in the top navigation
4. Click **Create App**
5. Select **Other** when asked "What do you want your app to do?"
6. Click **Next**
7. Select **Business** as the app type
8. Click **Next**
9. Fill in the app details:
   - **App Name**: `RestroPulse` (or your preferred name)
   - **App Contact Email**: Your email address
   - **Business Account**: Select existing or create new (optional for development)
10. Click **Create App**
11. Complete the security check if prompted

---

## Step 2: Add Required Products

From your App Dashboard, you need to add three products:

### Add Instagram API Setup

1. On the App Dashboard, scroll down to **Add Products to Your App**
2. Find **Instagram** and click **Set Up**
3. Select **API setup with Facebook login**
4. This enables Instagram API access for your app

### Add Facebook Login for Business

1. Return to the Dashboard (click Dashboard in sidebar)
2. Find **Facebook Login for Business** and click **Set Up**
3. Select **Web** as the platform
4. Skip the quickstart wizard (click **Settings** in the sidebar under Facebook Login)

### Add Webhooks (Optional but Recommended)

1. Return to the Dashboard
2. Find **Webhooks** and click **Set Up**
3. This enables real-time notifications for comments, messages, and story insights

---

## Step 3: Configure Facebook Login

1. In the left sidebar, expand **Facebook Login for Business**
2. Click **Settings**
3. Configure the following settings:

### OAuth Settings

| Setting | Value |
|---------|-------|
| Client OAuth Login | Yes |
| Web OAuth Login | Yes |
| Enforce HTTPS | Yes (for production) |
| Valid OAuth Redirect URIs | See below |

### Valid OAuth Redirect URIs

Add these URLs based on your environment:

**Development:**
```
http://localhost:3001/api/integrations/instagram/callback
```

**Production:**
```
https://your-domain.com/api/integrations/instagram/callback
```

4. Click **Save Changes**

### Deauthorize Callback URL (Required for Production)

In Facebook Login settings, configure the **Deauthorize Callback URL**:

**Development:**
```
http://localhost:3001/api/integrations/instagram/deauthorize
```

**Production:**
```
https://your-domain.com/api/integrations/instagram/deauthorize
```

### Data Deletion Request URL (Required for GDPR Compliance)

Under **App Settings** > **Basic**, configure the **Data Deletion Request URL**:

**Development:**
```
http://localhost:3001/api/integrations/instagram/data-deletion
```

**Production:**
```
https://your-domain.com/api/integrations/instagram/data-deletion
```

This endpoint is required by Meta for GDPR compliance and handles user data deletion requests.

---

## Step 4: Get App Credentials

1. In the left sidebar, go to **App Settings** > **Basic**
2. You will see:
   - **App ID**: Copy this value
   - **App Secret**: Click **Show**, enter your Facebook password, then copy the value

**Important**: Never expose your App Secret in client-side code or public repositories.

---

## Step 5: Configure Environment Variables

Update your `restropulse-pwa-backend/.env` file with the credentials:

```env
# Instagram OAuth Integration
INSTAGRAM_APP_ID=your_app_id_here
INSTAGRAM_APP_SECRET=your_app_secret_here
INSTAGRAM_REDIRECT_URI=http://localhost:3001/api/integrations/instagram/callback
```

Restart the backend server after updating:

```bash
cd restropulse-pwa-backend
npm run dev
```

---

## Step 6: Add Test Users (Development Mode)

While your app is in Development mode, only users with a role on the app can authenticate.

### Option A: Add Facebook Test Users

1. Go to **App Roles** > **Roles** in the sidebar
2. Scroll to **Test Users**
3. Click **Add** to create test users
4. These are dummy accounts for testing

### Option B: Add Real Users as Testers (Recommended)

1. Go to **App Roles** > **Roles**
2. Under **People**, click **Add People**
3. Select role: **Tester**
4. Enter the Facebook username or email of the person
5. Click **Add**

### Accept Tester Invitation

The invited user must accept:

1. Log in to Facebook as the invited user
2. Go to [https://developers.facebook.com/requests/](https://developers.facebook.com/requests/)
3. Accept the pending invitation

---

## Step 7: Prepare for Production

To go live and allow any user to connect, you must complete these requirements:

### 7.1 App Settings (Required)

Go to **App Settings** > **Basic** and fill in:

| Field | Requirement |
|-------|-------------|
| App Icon | 1024x1024 PNG image |
| Privacy Policy URL | Public URL (e.g., `https://your-domain.com/privacy-policy`) |
| Terms of Service URL | Public URL (e.g., `https://your-domain.com/terms`) |
| App Category | Select "Business" or appropriate category |
| App Purpose | Describe what your app does |

### 7.2 Business Verification (May Be Required)

For certain permissions, Meta requires business verification:

1. Go to [Meta Business Suite](https://business.facebook.com/)
2. Navigate to **Settings** > **Business Info**
3. Click **Start Verification**
4. Provide business documents (registration, utility bill, etc.)
5. Wait for approval (can take 1-5 business days)

### 7.3 Create Required Pages

Create these pages in your RestroPulse frontend and deploy them publicly:

**Privacy Policy** (`/privacy-policy`):
- What data you collect
- How you use the data
- How users can request data deletion
- Contact information

**Terms of Service** (`/terms`):
- User responsibilities
- Service limitations
- Liability disclaimers

---

## Step 8: Submit for App Review

RestroPulse requires these permissions with **Advanced Access**:

| Permission | Purpose |
|------------|---------|
| `instagram_basic` | Read Instagram profile information |
| `instagram_content_publish` | Publish posts on behalf of users |
| `instagram_manage_comments` | Read and respond to comments on posts |
| `instagram_manage_insights` | Access analytics and insights data |
| `pages_show_list` | List Facebook Pages the user manages |
| `pages_read_engagement` | Read Page engagement data |
| `public_profile` | Access basic Facebook profile |

> **Important**: Before requesting Advanced Access, you must make at least **1 successful API call** for each permission. Test your integration thoroughly in Development mode first.

### Start the Submission (New Dashboard Flow)

1. In the left sidebar under **Products**, go to **Instagram** > **API setup with Facebook login**
2. Click the chevron in the upper right corner of the **Complete app review** section
3. Review the permissions and features you are requesting
4. Click **Continue to app review** (redirects to App Review > Requests)
5. Click **Edit** to start the review flow

### Complete App Settings

You will be prompted to verify these are complete:
- App icon (1024x1024)
- Privacy Policy URL
- App Category
- Business Email (in Developer Settings)

### Provide Verification Details

For each platform (Web, iOS, Android) your app supports:
1. Provide step-by-step instructions for reviewers to test your app
2. Include test credentials if login is required
3. Be specific about when and how each permission is used

### Permission & Feature Requests

For each permission:
1. Click the arrow icon next to the permission
2. Describe how your app uses that specific permission
3. Upload a screencast showing the feature
4. Agree to comply with the allowed usage
   
### Screencast Requirements

Your video must show:

1. Login button or link visible and adhering to Meta brand guidelines
2. User clicking "Connect Instagram" button
3. Facebook OAuth login flow
4. User granting permissions
5. The specific feature that uses the permission (e.g., publishing a post)
6. Where the data appears in your app

**Official Meta Requirements:**
- **Use English as the app UI language** - Set your app to English before recording
- **Provide captions and tooltips** - If not in English, add explanatory captions
- **Explain button meanings** - Clarify what each UI element does
- **Show the complete user journey** - End-to-end experience for each permission

**Tips:**
- Use a screen recording tool (OBS, Loom, etc.)
- Keep videos under 2 minutes each
- Show real UI, not mockups
- Each screencast should focus on ONE permission

### Example Permission Description

For `instagram_content_publish`:

```
RestroPulse is a social media management platform for restaurants. 
Restaurant owners connect their Instagram Business accounts to schedule 
and publish promotional content (images with captions) directly from 
our dashboard. This permission allows us to publish posts on behalf 
of authenticated restaurant owners to their connected Instagram accounts.
```

3. Click **Submit for Review**

---

## Step 9: Go Live

Once your permissions are approved (or for testing with Standard Access):

1. Go to your App Dashboard
2. Look for the **App Mode** toggle at the top (shows "Development")
3. Click the toggle to switch to **Live**
4. Confirm the action

**Note**: If any required fields are missing, Meta will show an error listing what needs to be completed.

---

## Step 11: Setup Webhooks (Optional)

Webhooks allow you to receive real-time notifications when users comment on posts, send messages, or when stories expire.

### Requirements

- Your app must be in **Live mode** to receive webhook notifications
- Your server must have a valid **TLS/SSL certificate** (self-signed certificates are NOT supported)
- Advanced Access is required for `comments` and `live_comments` webhooks

### Create a Webhook Endpoint

Your server must handle two types of requests:

#### 1. Verification Requests (GET)

Meta sends a GET request to verify your endpoint:

```
GET https://your-domain.com/webhooks?
  hub.mode=subscribe&
  hub.challenge=1158201444&
  hub.verify_token=your_verify_token
```

Your endpoint must:
- Verify `hub.verify_token` matches your configured token
- Respond with the `hub.challenge` value

#### 2. Event Notifications (POST)

Meta sends POST requests with event data:

```json
{
  "object": "instagram",
  "entry": [{
    "id": "instagram_business_account_id",
    "time": 1520383571,
    "changes": [{
      "field": "comments",
      "value": { ... }
    }]
  }]
}
```

Your endpoint must:
- Validate the `X-Hub-Signature-256` header (SHA256 signature using App Secret)
- Respond with `200 OK` immediately
- Process the payload asynchronously

### Configure Webhooks in App Dashboard

1. Go to **Webhooks** in the left sidebar
2. Select **Instagram** from the dropdown
3. Click **Subscribe to this object**
4. Enter your **Callback URL**: `https://your-domain.com/api/webhooks/instagram`
5. Enter your **Verify Token**: A secret string you create
6. Click **Verify and Save**

### Subscribe to Webhook Fields

After the endpoint is verified, subscribe to fields:

| Field | Description |
|-------|-------------|
| `comments` | New comments on media |
| `messages` | Direct messages |
| `story_insights` | Story metrics (first 24 hours only) |
| `mentions` | When your account is @mentioned |

### Enable Subscriptions via API

Call the API to enable subscriptions for each Instagram account:

```bash
curl -X POST \
  "https://graph.instagram.com/v24.0/{ig-user-id}/subscribed_apps?subscribed_fields=comments,messages&access_token={access-token}"
```

### Webhook Limitations

- Account-level customization is not supported (all subscribed fields trigger notifications)
- Instagram account must be **public** to receive comment/mention notifications
- Live comments are only sent during the broadcast
- Album IDs are not included in notifications

---

## Troubleshooting

### "Invalid App ID" Error

- Verify the App ID in your `.env` matches the one in App Settings > Basic
- Ensure the backend server was restarted after updating `.env`

### "App Not Set Up" or "Cannot Load URL"

- Check that the redirect URI in Facebook Login settings exactly matches your `.env`
- For localhost, ensure you're using `http://` not `https://`

### "User is not a tester" Error

- The Facebook account must be added as a Tester (Step 6)
- The user must accept the tester invitation

### OAuth Redirect URI Mismatch

Ensure these three values match exactly:
1. `INSTAGRAM_REDIRECT_URI` in your `.env`
2. Valid OAuth Redirect URIs in Facebook Login Settings
3. The callback URL your backend sends to Meta

### "Permissions Required" After Login

- The required permissions haven't been granted Advanced Access
- Either add the user as a Tester, or complete App Review

### Business Verification Pending

- Some features require business verification first
- Check status in Meta Business Suite > Settings > Business Info

---

## Required Permissions Summary

| Permission | Access Level | Requires App Review | Purpose |
|------------|--------------|---------------------|----------|
| `public_profile` | Standard | No | Basic Facebook profile |
| `pages_show_list` | Advanced | Yes | List user's Facebook Pages |
| `pages_read_engagement` | Advanced | Yes | Read Page engagement data |
| `instagram_basic` | Advanced | Yes | Read Instagram profile info |
| `instagram_content_publish` | Advanced | Yes | Publish posts to Instagram |
| `instagram_manage_comments` | Advanced | Yes | Read/reply to comments |
| `instagram_manage_insights` | Advanced | Yes | Access analytics data |

---

## Useful Links

- [Meta for Developers](https://developers.facebook.com/)
- [Instagram Platform Documentation](https://developers.facebook.com/docs/instagram-platform)
- [Business Login for Instagram](https://developers.facebook.com/docs/instagram-platform/instagram-api-with-facebook-login/business-login-for-instagram)
- [Instagram App Review](https://developers.facebook.com/docs/instagram-platform/app-review/)
- [Webhooks Setup Guide](https://developers.facebook.com/docs/instagram-platform/webhooks)
- [Content Publishing](https://developers.facebook.com/docs/instagram-platform/content-publishing)
- [Facebook Login Documentation](https://developers.facebook.com/docs/facebook-login/)
- [App Review Best Practices](https://developers.facebook.com/docs/resp-plat-initiatives/app-review/before-you-submit)
- [Sample Screencast Submissions](https://developers.facebook.com/docs/app-review/submission-guide/screen-recordings)
- [Business Verification](https://www.facebook.com/business/help/2058515294227817)

---

## Environment Variables Reference

```env
# Required for Instagram Integration
INSTAGRAM_APP_ID=your_meta_app_id
INSTAGRAM_APP_SECRET=your_meta_app_secret
INSTAGRAM_REDIRECT_URI=http://localhost:3001/api/integrations/instagram/callback

# Security (generate your own for production)
ENCRYPTION_KEY=64_character_hex_string_for_aes256
JWT_SECRET=your_jwt_secret
```

To generate a secure encryption key:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

---

*Last updated: January 2026*
