# DeepSeek

Use DeepSeek's official Harness as a separate provider. Install it on the environment's machine
with `npm install -g @deepseek-ai/dsh`; Node.js 24.9 or newer is required.

On web and desktop, choose **Settings → Providers → Add provider → Add DeepSeek**,
enter a DeepSeek API key, and choose the default model. On mobile, add the DeepSeek
provider and set `DEEPSEEK_API_KEY` as a sensitive environment variable in its settings.
API usage is billed by DeepSeek.

Each instance has its own Harness home under the environment's T3 data directory.
**DeepSeek Harness home** can point to another directory when you need to reuse its sessions.
The API key must be configured on the instance; another provider's inherited key is not used.
Removing the T3 provider keeps the Harness's persisted sessions.

The provider supports streaming, tools, cancellation, model selection, native session resume,
and portable context handoff to other providers. It currently offers **Supervised** mode.
The Harness's ACP interface does not expose native conversation rollback, fork, planning cards,
or application text generation. T3 uses portable history handoff where supported.

Older DeepSeek presets using Claude Code remain separate Claude providers. Create a new DeepSeek
provider to use the official Harness; switching from an older preset transfers context through a
portable handoff.
