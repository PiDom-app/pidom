// `electron-squirrel-startup` ships no type declarations. It default-exports a
// boolean: true while the Squirrel installer is driving a shortcut lifecycle
// event, in which case the app should quit immediately.
declare module 'electron-squirrel-startup' {
  const started: boolean;
  export default started;
}
