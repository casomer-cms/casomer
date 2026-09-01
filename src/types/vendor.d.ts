// Ambient declarations for vendored codec typings. @jsquash's entry
// point d.ts files reference a global EmscriptenWasm namespace whose
// declaration file (emscripten-types.d.ts) is never imported by
// anything, so the compiler needs it declared here. Shapes stay
// permissive - the packages own the real contracts at runtime.

declare namespace EmscriptenWasm
{
    interface ModuleOpts
    {
        [ key: string ]: unknown;
    }

    interface Module
    {
        [ key: string ]: unknown;
    }

    type ModuleFactory<T extends Module = Module> = ( moduleOverrides?: ModuleOpts ) => Promise<T>;
}
