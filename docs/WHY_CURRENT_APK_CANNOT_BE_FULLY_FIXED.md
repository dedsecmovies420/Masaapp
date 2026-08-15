The supplied archive contained only `app-debug.apk`.

An APK is a compiled artifact. It does not reliably preserve the original Gradle project,
source structure, backend implementation, secrets, signing configuration, or server-side code.

The new repository therefore provides a clean, editable starter rather than falsely claiming
that the original APK has been fully repaired.

If the original source project is ever recovered, its UI/components can be migrated into this
architecture.
