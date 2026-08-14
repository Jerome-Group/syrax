# Configuration

[The example configuration](../config/syrax.example.toml) is a public interface sketch. It names
the decisions a deployment must make without pretending that the current repository already parses
the file. A runtime adapter may translate this contract into its own configuration, but it must
keep the boundary intact.

| Section | Meaning | Public value |
|---------|---------|--------------|
| runtime | The selected adapter and executable entrypoint | Placeholder until a runtime is chosen |
| model | Provider and model selection | Names only; credentials stay outside the file |
| paths | Roots for private state and chat archives | Absolute paths outside this repository |
| security | Secret source and tool policy | Environment/private store plus explicit allowlist |
| observability | Log and trace handling | Sanitised local output by default |

## Local configuration

Use a filename matching config/*.local.* or config/*.secret.*; those patterns are ignored. A local
file is still not automatically safe: keep its parent directory private, inspect the diff before
every commit, and prefer environment variables or a dedicated secret store for credentials.

## State placement

The runtime state path must not be a child of this repository. This includes chat history, memory,
browser sessions, caches, databases, logs, and provider responses. A path outside the checkout
means a broad git add cannot accidentally turn a live session into a public commit.
