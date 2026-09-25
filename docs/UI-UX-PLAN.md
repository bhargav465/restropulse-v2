# UI/UX Overhaul Plan -- RestroPulse Mobile-First PWA

## Goals

- Make the UI feel light, clean, and uncluttered
- Group account-related actions behind a profile icon (familiar pattern)
- Simplify the bottom navigation to 4 core workflows
- Remove dark in-app cards in favor of a fully light aesthetic
- Fix broken/non-functional UI elements
- Adhere to project conventions (no emoji, no special characters)

---

## Summary of Changes

| Area | Current | After |
|------|---------|-------|
| Bottom nav | 5 items (Dashboard, Studio, +FAB=Inputs, Strategy, Settings) | 4 flat items (Home, Studio, Updates, Strategy) |
| Header (right) | Empty | Bell icon + Profile avatar |
| Settings page | Full nav tab with profile, integrations, AM, subscription, logout, delete | Removed from nav; contents moved to profile bottom sheet |
| Center FAB | Navigates to Inputs page | Removed entirely |
| "Create Post" button | Gradient button above Studio tab bar | Contextual `+` icon in header (Studio page only) + empty state CTA |
| Dashboard dark card | slate-800/900 "Live on Profile" | Light card with subtle border and color accents |
| Inputs dark card | slate-900 "Update Us" hero | Light card with subtle border |
| Dashboard bell icon | Non-functional cosmetic element | Functional placeholder in header (app-wide) |
| Dashboard pull-to-refresh | Fake (animation only, no data reload) | Fixed to actually reload data |
| Dashboard emoji | Wave emoji in welcome text | Removed |
| Dashboard "Coming Soon" cards | 2 large blurred locked cards | Single compact teaser banner |
| Page title inconsistency | "CONTENT STRATEGY" (all caps) | "Strategy" (title case) |
| Account Manager | Static display in Settings | Profile sheet with WhatsApp chat action |
| ViewState type | Includes 'SETTINGS' | Remove 'SETTINGS' |
| Studio empty state | Generic "no posts" message | CTA card with "Create your first post" button |

---

## Detailed Plan by File

### Phase 1: Shared Type Update

#### File: `packages/shared/src/index.ts`

**Change:** Remove `'SETTINGS'` from `ViewState` type union.

```
Before: 'LOGIN' | 'ONBOARDING' | 'DASHBOARD' | 'STUDIO' | 'INPUTS' | 'STRATEGY' | 'SETTINGS'
After:  'LOGIN' | 'ONBOARDING' | 'DASHBOARD' | 'STUDIO' | 'INPUTS' | 'STRATEGY'
```

Note: `'INPUTS'` remains in the type but the nav label changes to "Updates" in the UI only.

---

### Phase 2: Layout Overhaul (Layout.tsx)

#### 2a. Header -- Add right-side actions

Current header (left side only):
```
[R logo]  RestroPulse
          {page title}
```

New header:
```
[R logo]  {Restaurant Name}       [+]?  [Bell]  [Avatar]
          {page subtitle}
```

- **Restaurant name** replaces "RestroPulse" branding (user's brand first)
- **Page subtitle** replaces the current page title position (smaller, secondary)
- **`[+]` icon** -- only visible when `currentView === 'STUDIO'`; triggers `onCreatePost` callback
- **Bell icon** -- always visible; placeholder with badge dot (non-functional for now, reserved for upcoming notifications)
- **Avatar** -- user initials circle (e.g., "AM" for Arjun Mehta); tapping opens profile bottom sheet

New props for Layout:
```ts
interface LayoutProps {
  children: React.ReactNode;
  currentView: ViewState;
  setView: (view: ViewState) => void;
  title: string;                    // page subtitle text
  restaurantName: string;           // shown in header
  userInitials: string;             // for avatar circle
  pendingCount?: number;            // for bell badge
  onCreatePost?: () => void;        // for Studio "+" button
  onProfileOpen: () => void;        // opens profile sheet
}
```

#### 2b. Bottom Navigation -- 4 flat items, no FAB

Remove the elevated center FAB. Replace with 4 equal-width items:

| Position | View | Icon | Label |
|----------|------|------|-------|
| 1 | DASHBOARD | `Home` | Home |
| 2 | STUDIO | `PenTool` | Studio |
| 3 | INPUTS | `Megaphone` | Updates |
| 4 | STRATEGY | `Lightbulb` | Strategy |

- All items use the same `NavItem` component (no special sizing)
- Active state: `text-orange-600`, inactive: `text-slate-400`
- Remove `UserCog`/Settings from nav entirely

#### 2c. Profile Bottom Sheet (new component within Layout)

A bottom sheet triggered by tapping the avatar in the header. Contains all account-related actions previously in Settings.tsx.

Structure:
```
+------------------------------------------+
|  [drag handle]                           |
|                                          |
|  [Avatar]  User Name                     |
|            Restaurant Name               |
|            City, State                   |
+------------------------------------------+
|  [Edit3]    Edit Restaurant Profile   >  |   -> opens EditProfileModal
|  [Users]    Account Manager           >  |   -> shows AM card with WhatsApp
|  [CreditCard] Subscription (Gold)     >  |   -> opens SubscriptionModal
+------------------------------------------+
|  Integrations                            |
|  [IG icon]  Instagram    Connected/Connect|
+------------------------------------------+
|  [LogOut]   Log Out                      |
|  [Trash2]   Delete Account               |
+------------------------------------------+
```

- Uses the same bottom sheet pattern as existing modals (backdrop blur, drag-to-dismiss, history push/pop)
- Account Manager row shows: avatar, name, "Account Manager" subtitle, and a WhatsApp icon button on the right that opens `https://wa.me/{phone}` (strip + and spaces from phone number)
- Instagram row shows connection status; tapping opens the setup guide modal (reuses existing `InstagramSetupGuide` logic)
- Edit Profile and Subscription open their existing modals (moved from Settings.tsx)

---

### Phase 3: App.tsx Updates

#### 3a. Remove Settings from view routing

- Remove `case 'SETTINGS'` from `renderView()` and `getPageTitle()`
- Remove the `Settings` component import (component will be deleted)
- Move `handleLogout` to be passed to Layout (profile sheet needs it)
- Add state for profile sheet: `isProfileOpen` / `setIsProfileOpen`
- Add state/callback for AdhocPostModal at the app level (or pass down to Layout)

#### 3b. Pass new props to Layout

```tsx
<Layout
  currentView={currentView}
  setView={navigateTo}
  title={getPageTitle()}
  restaurantName={restaurantData?.name || ''}
  userInitials={getUserInitials()}
  pendingCount={pendingCount}
  onCreatePost={() => setIsAdhocModalOpen(true)}
  onProfileOpen={() => setIsProfileOpen(true)}
>
```

#### 3c. Lift AdhocPostModal state

Currently AdhocPostModal state lives in ContentStudio. It needs to move to App.tsx since the `+` trigger is now in the header (rendered by Layout). The modal itself can remain at the App level.

#### 3d. Lift user data

Dashboard currently fetches user data independently. The user name/initials are needed by the header (for the avatar). Fetch user data in App.tsx during initialization and pass it down.

---

### Phase 4: Dashboard.tsx Cleanup

#### 4a. Remove non-functional notification bell
- Delete the Bell icon from Dashboard welcome header (lines 126-129)
- Bell is now in the app-wide header (Layout.tsx)

#### 4b. Remove emoji
- Line 124: Change `{user?.name.split(' ')[0] || 'User'} [wave emoji]` to `{user?.name.split(' ')[0] || 'User'}`

#### 4c. Fix pull-to-refresh
- The `handleTouchEnd` handler (line 71) currently does a fake 1500ms timeout
- Fix it to actually call `loadData()` and await completion before clearing the refresh state

#### 4d. Light "Live on Profile" card
- Replace `bg-gradient-to-br from-slate-800 to-slate-900` with a light treatment:
  - `bg-white border border-slate-200 rounded-2xl shadow-sm`
  - Change text colors from `text-white` / `text-slate-400` to `text-slate-800` / `text-slate-500`
  - Keep the Tag/UtensilsCrossed icons with their existing accent colors (purple-400, orange-400)

#### 4e. Minimize "Coming Soon" locked cards
- Replace the two large blurred cards (lines 269-322) with a single compact banner:
  ```
  +----------------------------------------------+
  |  [Sparkles]  Advanced insights coming soon    |
  +----------------------------------------------+
  ```
- Single line, `bg-slate-50 border border-slate-100`, subtle text
- Removes ~150 lines of fake blurred metrics UI

#### 4f. Remove user data fetching
- Dashboard currently fetches `authAPI.checkSession()` for user data (line 22)
- User data will be passed as a prop from App.tsx instead (avoids duplicate API calls)

---

### Phase 5: ContentStudio.tsx Updates

#### 5a. Remove "New Post" button from Studio
- Delete the gradient button block (lines 848-859)
- The `+` action is now in the header via Layout
- Remove `isAdhocModalOpen` state and `AdhocPostModal` rendering from ContentStudio (moved to App.tsx)

#### 5b. Accept `onCreatePost` callback as prop
- ContentStudio needs a way to trigger post creation from its empty state CTA
- Add prop: `onCreatePost: () => void`

#### 5c. Enhanced empty state for Review tab
When the Review tab is empty AND there are no posts at all (new user), show a CTA card:
```
+----------------------------------------------+
|                                              |
|    [PenTool icon in circle]                  |
|                                              |
|    Create your first post                    |
|    Describe your idea and our team           |
|    will craft the perfect content.           |
|                                              |
|    [  + Create Post  ]  (button)             |
|                                              |
+----------------------------------------------+
```
- Only shown when total posts across all tabs is 0
- Button calls `onCreatePost` prop
- When there ARE posts but the current tab is empty, keep the existing lighter empty state messages

---

### Phase 6: Inputs.tsx (now "Updates") -- Light Theme

#### 6a. Light hero card
- Replace `bg-slate-900 rounded-3xl p-6 text-white` with:
  - `bg-white border border-slate-200 rounded-2xl p-6 shadow-sm`
  - Title: `text-slate-800` instead of `text-white`
  - Subtitle: `text-slate-500` instead of `text-slate-400`

#### 6b. No other functional changes
- The component's behavior, modals, and active context section remain unchanged
- Only the visual treatment of the top hero card changes

---

### Phase 7: Strategy.tsx -- Minor Fixes

#### 7a. Fix page title
- In App.tsx `getPageTitle()`, change `'CONTENT STRATEGY'` to `'Strategy'`

#### 7b. No other changes needed
- Strategy page structure is clean as-is

---

### Phase 8: Settings.tsx -- Decompose and Delete

#### 8a. Extract reusable pieces into Layout.tsx (or a new ProfileSheet component)

Move the following from Settings.tsx into the profile bottom sheet:

| Feature | Source in Settings.tsx | Target |
|---------|----------------------|--------|
| Restaurant profile display | Lines 752-770 | Profile sheet header |
| Edit Profile modal | `EditProfileModal` (lines 571-622) | Triggered from profile sheet |
| Instagram connection UI | Lines 773-851 | Profile sheet "Integrations" section |
| Instagram setup guide modal | `InstagramSetupGuide` (lines 342-454) | Reused as-is |
| Instagram error modal | `InstagramErrorModal` (lines 457-507) | Reused as-is |
| Account picker modal | `AccountPickerModal` (lines 510-558) | Reused as-is |
| Account Manager display | Lines 854-866 | Profile sheet row with WhatsApp action |
| Subscription section | Lines 868-901 | Profile sheet row |
| Subscription modal | `SubscriptionModal` (lines 624-741) | Triggered from profile sheet |
| Logout button | Line 888-893 | Profile sheet bottom |
| Delete Account button | Lines 894-899 | Profile sheet bottom |

#### 8b. Add WhatsApp action to Account Manager

Current Account Manager section is display-only. Add a WhatsApp icon button:
```tsx
<a
  href={`https://wa.me/${restaurantData.accountManager.phone.replace(/[^0-9]/g, '')}`}
  target="_blank"
  rel="noopener noreferrer"
  className="w-9 h-9 bg-green-100 text-green-600 rounded-lg flex items-center justify-center"
>
  <WhatsAppIcon size={18} />
</a>
```

#### 8c. Delete Settings.tsx
- After all content is migrated, delete the file entirely
- Remove import from App.tsx

---

### Phase 9: BrandIcons.tsx -- No Changes

No modifications needed. Instagram and Facebook icons are reused as-is in the profile sheet.

---

## File Change Summary

| File | Action | Scope |
|------|--------|-------|
| `packages/shared/src/index.ts` | Edit | Remove `'SETTINGS'` from ViewState |
| `apps/web/components/Layout.tsx` | Major rewrite | New header, 4-item nav, profile bottom sheet |
| `apps/web/App.tsx` | Edit | Remove Settings routing, lift AdhocModal + user state, pass new Layout props |
| `apps/web/components/Dashboard.tsx` | Edit | Remove bell/emoji, fix pull-to-refresh, light cards, minimize Coming Soon |
| `apps/web/components/ContentStudio.tsx` | Edit | Remove New Post button, add onCreatePost prop, enhanced empty state |
| `apps/web/components/Inputs.tsx` | Edit | Light hero card |
| `apps/web/components/Strategy.tsx` | No change | (title fix is in App.tsx) |
| `apps/web/components/Settings.tsx` | Delete | All content migrated to profile sheet in Layout |
| `apps/web/components/AdhocPostModal.tsx` | No change | Rendered from App.tsx instead of ContentStudio |
| `apps/web/components/Onboarding.tsx` | No change | |
| `apps/web/components/Login.tsx` | No change | |
| `apps/web/components/ErrorBoundary.tsx` | No change | |
| `apps/web/components/BrandIcons.tsx` | No change | |
| `apps/web/components/InstagramCallback.tsx` | No change | |
| `apps/web/tests/Onboarding.test.tsx` | May need update | If ViewState type change causes test failures |

## Implementation Order

1. `packages/shared/src/index.ts` -- ViewState type (unblocks everything)
2. `apps/web/components/Layout.tsx` -- Header + nav + profile sheet (biggest change)
3. `apps/web/App.tsx` -- Wire up new Layout props, remove Settings routing, lift state
4. `apps/web/components/Dashboard.tsx` -- Light theme + cleanup
5. `apps/web/components/ContentStudio.tsx` -- Remove button, add empty state CTA
6. `apps/web/components/Inputs.tsx` -- Light hero
7. Delete `apps/web/components/Settings.tsx`
8. Run tests, fix any breakages from ViewState change

## Design Tokens (consistency reference)

To ensure visual consistency across the light UI:

| Element | Treatment |
|---------|-----------|
| Page background | `bg-slate-50` (unchanged) |
| Cards | `bg-white border border-slate-100 rounded-2xl shadow-sm` |
| Section headers | `text-sm font-bold text-slate-400 uppercase tracking-wider` |
| Primary buttons | `bg-slate-900 text-white rounded-xl` |
| Secondary buttons | `border border-slate-200 text-slate-600 rounded-xl` |
| Accent color | `orange-500` / `orange-600` (unchanged) |
| Active nav | `text-orange-600` |
| Inactive nav | `text-slate-400` |
| Border radius (small) | `rounded-xl` |
| Border radius (cards/modals) | `rounded-2xl` |
| Bottom sheets | `rounded-t-3xl` on mobile, `rounded-2xl` on sm+ |
