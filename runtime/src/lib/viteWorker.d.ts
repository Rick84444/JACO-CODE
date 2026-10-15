// Vite `?worker` imports (used by monacoSetup.ts) without pulling in vite/client ambient types.
declare module '*?worker' {
  const WorkerConstructor: { new (): Worker };
  export default WorkerConstructor;
}
