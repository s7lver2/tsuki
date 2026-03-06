// ─────────────────────────────────────────────────────────────────────────────
//  pages/Installation.tsx
//  "Installation" doc page — prerequisites, build from source, config keys
// ─────────────────────────────────────────────────────────────────────────────

import { useState } from 'react'
import { H2, P, UL, LI, Divider, InlineCode, Note, CodeBlock, Table } from '../DocsPrimitives'

type OS = 'linux' | 'mac' | 'win'

const OS_LABELS: Record<OS, string> = { linux: '🐧 Linux', mac: '🍎 macOS', win: '🪟 Windows' }

const INSTALL_COMMANDS: Record<OS, string> = {
  linux: `# 1. Download the repository Release Installer and run it
curl http://tsuki.s7lver.xyz/installer.sh | bash

# 2. Done
tsuki --version`,

  mac: `# 1. Download the repository Release Installer and run it
curl http://tsuki.s7lver.xyz/installer.sh | bash

# 2. Done
tsuki --version`,

  win: `# 1. Download Installer
curl -O http://tsuki.s7lver.xyz/installer.exe


# 2. Run the installer
./installer.exe

# 3. Done
tsuki --version`
}

const CONFIG_ROWS: string[][] = [
  ['libs_dir',           'Package install location',        '~/.local/share/tsuki/libs'],
  ['registry_url',       'Package registry URL',            'GitHub (tsuki-pkgs)'],
  ['board',              'Default board for new projects',  'uno'],
  ['backend',            'Compiler backend',                'tsuki-flash'],
  ['verify_signatures',  'Verify package Ed25519 sigs',     'false'],
]

export default function InstallationPage() {
  const [os, setOs] = useState<OS>('linux')

  return (
    <div>
      <P>
        tsuki requires a Rust toolchain to build <InlineCode>tsuki-core</InlineCode> and{' '}
        <InlineCode>tsuki-flash</InlineCode>, and a Go toolchain to build the CLI.
        The IDE is pre-built and does not require Node.js to run.
      </P>

      <H2>Prerequisites</H2>
      <UL>
        <LI>A USB cable and a supported Arduino / ESP board (Optional)</LI>
      </UL>

      <Note kind="tip">
        <strong>arduino-cli is optional.</strong> tsuki ships its own compiler backend (
        <InlineCode>tsuki-flash</InlineCode>). On first build it auto-downloads the AVR core (~40 MB).
      </Note>

      <Divider />
      <H2>Install from source</H2>

      {/* OS tab switcher */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
        {(Object.keys(OS_LABELS) as OS[]).map(o => (
          <button
            key={o}
            onClick={() => setOs(o)}
            style={{
              border: `1px solid ${os === o ? 'var(--fg-muted)' : 'var(--border)'}`,
              background: os === o ? 'var(--surface-3)' : 'transparent',
              color: os === o ? 'var(--fg)' : 'var(--fg-muted)',
              borderRadius: 6, padding: '4px 12px',
              fontSize: 11, fontFamily: 'monospace', cursor: 'pointer',
            }}
          >
            {OS_LABELS[o]}
          </button>
        ))}
      </div>

      <CodeBlock lang="bash" filename="terminal">{INSTALL_COMMANDS[os]}</CodeBlock>

      <Divider />
      <H2>Verify the installation</H2>
      <CodeBlock lang="bash" filename="terminal">
{`tsuki --version
# tsuki v0.1.0

tsuki boards
# Lists all supported boards

tsuki config list
# Shows current configuration`}
      </CodeBlock>

      <Divider />
      <H2>Configuration</H2>
      <P>
        tsuki stores its config at <InlineCode>~/.config/tsuki/config.json</InlineCode>.
        Useful keys to set after install:
      </P>
      <CodeBlock lang="bash" filename="terminal">
{`# Custom package registry
tsuki config set registry_url https://raw.githubusercontent.com/s7lver2/tsuki-pkgs/main/registry.json

# Custom libs directory
tsuki config set libs_dir ~/.local/share/tsuki/libs

# Default board for new projects
tsuki config set board uno`}
      </CodeBlock>

      <Table
        cols={['Key', 'Description', 'Default']}
        rows={CONFIG_ROWS}
      />

      <Divider />
      <H2>Install the IDE</H2>
      <P>
        The tsuki IDE is built with Tauri. Download the pre-built installer from GitHub releases,
        or build it yourself:
      </P>
      <CodeBlock lang="bash" filename="terminal">
{`cd ide
npm install
npm run tauri build
# Installer output: ide/src-tauri/target/release/bundle/`}
      </CodeBlock>
    </div>
  )
}
