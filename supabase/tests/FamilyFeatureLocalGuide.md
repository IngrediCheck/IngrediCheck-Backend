# Family Feature – Local Testing Guide

This document is for quick sharing with mobile developers so they can test the family workflows against your local Supabase stack. Keep it outside version control if you don’t want it committed (e.g., add to your personal `.git/info/exclude`).

---

## 1. Start / Stop the Local Stack

From `supabase/tests/`:

```bash
./local-env.ts setup      # starts Docker containers
./local-env.ts teardown   # stops containers when you’re done
```

Prerequisites: Docker Desktop running, Supabase CLI installed, `.env` copied from `.env.template` with required secrets.

During setup the script prints the local base URL (`http://127.0.0.1:54321`) and anon key. Share the anon key with anyone using your tunnel/local IP.

---

## 2. Optional: Expose Your Stack via ngrok

If the mobile dev needs to hit your machine directly:

```bash
ngrok http 54321          # tunnel REST + edge functions
# optional for Studio: ngrok http 54323
```

Share the `https://...ngrok-*.app` URL from ngrok and the anon key. The tunnel must stay running while testing.

---

## 3. Core Endpoints & Sample Payloads

All requests require these headers:

```
apikey: <anon key>
Authorization: Bearer <anon key>
Content-Type: application/json
```

### 3.1 Create Family

`POST /ingredicheck/family`

```json
{
  "name": "Johnson Household",
  "selfMember": {
    "id": "6f4a3d2a-2b59-4dd5-912d-57641d4ad255",
    "name": "Morgan Johnson",
    "nicknames": ["MJ"],
    "info": "Primary owner",
    "color": "#0D3B66"
  },
  "otherMembers": [
    {
      "id": "9b71e92c-8722-4e07-a2a3-0e07e283e08b",
      "name": "Taylor Johnson",
      "nicknames": ["TJ"],
      "info": "Teen",
      "color": "#F95738"
    }
  ]
}
```

Response: `201 Created` (empty body).

### 3.2 Get Family Snapshot

`GET /ingredicheck/family`

```json
{
  "name": "Johnson Household",
  "selfMember": {
    "id": "6f4a3d2a-2b59-4dd5-912d-57641d4ad255",
    "name": "Morgan Johnson",
    "nicknames": ["MJ"],
    "info": "Primary owner",
    "color": "#0D3B66",
    "joined": true
  },
  "otherMembers": [
    {
      "id": "9b71e92c-8722-4e07-a2a3-0e07e283e08b",
      "name": "Taylor Johnson",
      "nicknames": ["TJ"],
      "info": "Teen",
      "color": "#F95738",
      "joined": false
    }
  ],
  "version": 1730380800
}
```

### 3.3 Create Invite

`POST /ingredicheck/family/invite`

```json
{ "memberID": "9b71e92c-8722-4e07-a2a3-0e07e283e08b" }
```

Response:

```json
{ "inviteCode": "f8c1995ad6af9420" }
```

### 3.4 Join Family (second user)

`POST /ingredicheck/family/join`

```json
{ "inviteCode": "f8c1995ad6af9420" }
```

Example success payload:

```json
{
  "name": "Johnson Household",
  "selfMember": {
    "id": "9b71e92c-8722-4e07-a2a3-0e07e283e08b",
    "name": "Taylor Johnson",
    "nicknames": ["TJ"],
    "info": "Teen",
    "color": "#F95738",
    "joined": true
  },
  "otherMembers": [
    {
      "id": "6f4a3d2a-2b59-4dd5-912d-57641d4ad255",
      "name": "Morgan Johnson",
      "nicknames": ["MJ"],
      "info": "Primary owner",
      "color": "#0D3B66",
      "joined": false
    }
  ],
  "version": 1730380860
}
```

### 3.5 Leave Family

`POST /ingredicheck/family/leave`

```json
{ "message": "Successfully left the family" }
```

### 3.6 Add Member

`POST /ingredicheck/family/members`

```json
{
  "id": "777d9a7d-2027-48ad-b8df-669d8d29f843",
  "name": "Skyler Shaw",
  "nicknames": ["Sky"],
  "info": "Child",
  "color": "#2A9D8F"
}
```

### 3.7 Edit Member

`PATCH /ingredicheck/family/members/777d9a7d-2027-48ad-b8df-669d8d29f843`

```json
{
  "name": "Skyler Avery",
  "nicknames": ["Skye", "S"],
  "info": "Renamed profile",
  "color": "#F4A261"
}
```

### 3.8 Delete Member

`DELETE /ingredicheck/family/members/777d9a7d-2027-48ad-b8df-669d8d29f843`

```json
{
  "name": "Morgan Household",
  "selfMember": { ... },
  "otherMembers": [
    {
      "id": "PARTNER_MEMBER_ID",
      "name": "Jordan Shaw",
      "nicknames": ["Jo"],
      "info": "Partner",
      "color": "#E76F51",
      "joined": false
    }
  ],
  "version": 1730381000
}
```

---

## 4. Error Scenarios to Expect

- `400` “User is not a member of any family” – call `POST /family` first or sign in as a user already linked to a member.
- `400` “Target member does not exist or is already joined” – the invite target must be an unclaimed member in the same family.
- `400` “Invalid or expired invite code” – invites expire after 30 minutes.
- `400` “Cannot delete yourself. Use leave_family instead.”
- `401` – missing or invalid anon token.

---

## 5. Replay Fixtures (optional automation)

If the mobile dev wants to run pre-recorded sequences against your stack:

```bash
./run-testcase-endtoend.ts all               # runs the three scenarios in order
./run-testcase-endtoend.ts family-create-and-fetch
./run-testcase-endtoend.ts family-invite-join
./run-testcase-endtoend.ts family-member-lifecycle
```

Each fixture will print pass/fail per request.

---

## 6. Reminder – Keep This Out of Git

If you prefer not to commit this file, add the path to your local git exclude:

```bash
echo "supabase/tests/FamilyFeatureLocalGuide.md" >> .git/info/exclude
```

Share the markdown with the mobile developer (email, Slack, etc.).


