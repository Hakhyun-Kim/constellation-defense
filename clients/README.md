# Engine client samples — one server, many viewers

The dedicated server (`dedicated/`) is engine-agnostic: one WebSocket, JSON
messages, roles decided at `hello`. These samples are the first step for
non-web clients — each connects to the same server the web viewer uses and
asserts the same contract that `npm run dedicated:check` enforces:

| Sample | Engine | Runs as |
|---|---|---|
| `unity/DedicatedProtocolSmokeTest.cs` | Unity 2021+ | Test Runner (play or edit mode) |
| `unreal/DedicatedProtocolSmokeTest.cpp` | Unreal 5 | Session Frontend → Automation |

Each test proves, from inside the engine's own runtime:

1. `hello` → `welcome` with `protocol: 2` and the granted role,
2. a `snapshot` carrying the documented render-state schema,
3. the auth boundary — a `command` without the controller key is `forbidden`,
4. the store gateway — a `store` catalog request answered with `200` and items
   on the same socket (no HTTP store client in the engine).

## Running

```bash
# In the repository root, with Node 22.9+:
npm run serve           # payment service + web client on :8642 (mock mode)
npm run dedicated       # ws://127.0.0.1:8643 — brokers store calls to :8642
```

Then run the test inside Unity/Unreal. `DEDICATED_URL` overrides the address
for a remote server.

- **Unity**: copy the file under `Assets/Tests/`, ensure the test assembly
  references the Unity Test Framework; `System.Net.WebSockets` ships with the
  .NET profile.
- **Unreal**: copy the file into the game module's test sources and add
  `"WebSockets", "Json"` to `PrivateDependencyModuleNames` in `Build.cs`.

## Status, honestly

These files are written against [`dedicated/PROTOCOL.md`](../dedicated/PROTOCOL.md)
and mirror the Node conformance check, but they compile only inside a Unity or
Unreal project — the machine that authored them has neither installed, so they
have not been executed yet. Treat them as the reviewed starting point for an
engine viewer, not as proof one exists. The next milestone for either engine is
rendering `snapshot.enemies`/`snapshot.field` into a scene and mapping
`decision` messages to captions — no game rules are needed client-side, which
is the point of the architecture.
