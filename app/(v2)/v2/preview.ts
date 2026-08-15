// The reason a /v2 control is disabled, in one place — and in a module with NO server imports.
//
// It lived in list-page.ts, which imports next/headers through lib/workspace. A SERVER component can
// import from there happily; a client component cannot, and the agenda's row actions are a client
// component. Importing it there dragged cookies() into the browser bundle and failed the build.
//
// The mirror of the note in channels.ts, which exists for the opposite direction: a server file must
// not import a client module, because its exports are proxies there. Same rule, both ways — a shared
// constant belongs in a file that takes no side.
export const PREVIEW = 'v2 preview'
