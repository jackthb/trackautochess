# Player lookup

## Sub-features

- Accept a SteamID64, vanity name, or Steam Community profile URL.
- Show client-side validation for malformed input.
- Resolve search results through `/api/players/search`.
- Navigate a chosen result to `/players/<steamId-or-custom-url>`.

## How to get to it (user POV)

Open Track Auto Chess at `/`. Under the `LOOK UP A PLAYER` divider, enter a Steam profile value in `Steam profile URL or SteamID64`, then choose `Search` or a returned player suggestion.

## Driving it with Cursor computer-use

For a dependency-free real path, fill `getByPlaceholder("Steam profile URL or SteamID64")` with `not a steam profile`, click `getByRole("button", { name: "Search" })`, and capture `Enter a SteamID64, vanity name, or profile URL.` without leaving `/`.

For a positive lookup, first confirm the instance has working Supabase configuration. Fill the same input with a real SteamID64 or profile URL, choose the returned player link by visible name, then assert the browser reaches `/players/…` and `getByRole("main")` is visible. Capture the `/api/players/search` status and response shape alongside the visible result.

## Gotchas

- The public web app boots without Supabase, but real player suggestions and profile data do not; client-side validation still works.
- Steam sign-in is an external production boundary and is not required for public lookup.
- The existing browser test mocks only `/api/players/search`; mocked proof must be labeled and cannot prove live Supabase data.
- Do not inject a session or navigate directly to a player route as a substitute for the search action.
