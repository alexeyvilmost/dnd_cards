# Auth and public section entrances

Local UI changes only. No server restart, API/role changes, browser automation,
or changes to App/Layout or character detail/editor protection were performed
by this task.

## Components and layout ownership

`AuthShell.tsx` / `AuthShell.css` render Login and Register using the existing
`Layout landing` header. The palette consumes `--site-bg`, `--site-gold`,
`--site-text`, and `--site-muted`, with green/gold fallbacks. Header styling
belongs to the shared `SiteTheme.css`; no HomePage CSS is imported. Own selectors
are limited to auth/guest content and its landing content width.

`../pages/GuestSectionPage.tsx` / `.css` provide illustrated public introductions
for `section="characters"` and `section="runs"`. Images are existing
`/images/home/interactive.jpg` and `/images/home/runs.jpg`. Login and registration
links preserve pathname, query, and fragment in the existing `state.from` shape.

`../components/AuthenticatedSectionGate.tsx` exports both a default and named
`AuthenticatedSectionGate`, with props:

```tsx
{ section: 'characters' | 'runs'; children: ReactNode }
```

While the session loads, it renders a loading state with the shared Layout.
Guests get `GuestSectionPage`, also with one Layout. Authenticated users receive
`children` unchanged: the gate does not add a second header/layout and does not
mount game content/providers for guests or during bootstrap.

App integration is owned by main and reported integrated for:

- `/characters-forge`: `section="characters"`
- `/roguelike` and `/roguelike/:id`: `section="runs"`

Place the gate **outside** the existing page's Layout and rules providers.
Actual character detail/editor routes must continue to use ProtectedRoute.
Login/Register already own Layout via AuthShell and need no extra App wrapper.

## Behavior retained

Password submission, signup fields/validation, default homepage destination,
safe explicit return path, switching Login ↔ Register with the same destination,
provider availability, disabled buttons, OAuth completion and errors, and the
existing session lifecycle are preserved. Password visibility buttons now have
stateful labels, `aria-pressed`, and `aria-controls`; inputs have autocomplete
and associated labels. Errors are announced via `role="alert"`.

## Verification

```text
node node_modules/vitest/vitest.mjs run src/auth src/components/AuthenticatedSectionGate.test.tsx src/components/ProtectedRoute.test.tsx src/contexts/AuthContext.test.tsx src/pages/Login.production.test.ts src/authReturnPath.test.ts
```

49 tests passed, including existing OAuth StrictMode/session tests. Addressed
UI files and their test files pass isolated TypeScript checking. No test
credentials are injected into product forms.

Browser QA is owned by main. Suggested views: `/login`, `/register`, guest
`/characters-forge`, guest `/roguelike`, and a guest `/roguelike/:id` with query
and fragment, at desktop and 390px width. Check shared header, focus outlines,
password toggles, disabled OAuth explanation, and return destination after
switching from login to signup. The form stacks below its illustration at 820px;
guest CTA buttons stack at 520px. No new image generation is involved.
