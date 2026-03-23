// ─────────────────────────────────────────────────────────────────────────────
//  tsuki-dk :: key  —  Ed25519 key management
//
//  Keys are stored in ~/.tsuki/keys/ as PEM files:
//    <n>.pem       — private key  (never leave your machine)
//    <n>.pub.pem   — public key   (add to tsuki-keys.json in your registry)
// ─────────────────────────────────────────────────────────────────────────────

package dk

import (
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"encoding/pem"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/spf13/cobra"
	"github.com/tsuki/cli/internal/ui"
)

func newKeyCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "key",
		Short: "Manage signing keys",
	}
	cmd.AddCommand(
		newKeyGenerateCmd(),
		newKeyExportCmd(),
		newKeyListCmd(),
	)
	return cmd
}

func newKeyGenerateCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "generate <n>",
		Short: "Generate a new Ed25519 signing key pair",
		Long: `Generate a new Ed25519 key pair for signing packages.

The private key is saved to ~/.tsuki/keys/<n>.pem  — keep this secret.
The public key is saved to ~/.tsuki/keys/<n>.pub.pem — add this to your
registry's tsuki-keys.json under your signer name.`,
		Example: `  tsuki-dk key generate tsuki-team
  tsuki-dk key generate my-org`,
		Args: cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			name := args[0]
			return generateKey(name)
		},
	}
}

func newKeyExportCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "export <n>",
		Short: "Print the public key in tsuki-keys.json format",
		Long: `Print the public key entry ready to paste into tsuki-keys.json.

Example output:
  "my-org": "ed25519:BASE64..."`,
		Args: cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			name := args[0]
			return exportPublicKey(name)
		},
	}
}

func newKeyListCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "list",
		Short: "List available signing keys",
		RunE: func(cmd *cobra.Command, args []string) error {
			return listKeys()
		},
	}
}

// ── Implementation ────────────────────────────────────────────────────────────

func generateKey(name string) error {
	keysDir := tsukiKeysDir()
	if err := os.MkdirAll(keysDir, 0700); err != nil {
		return err
	}

	privPath := filepath.Join(keysDir, name+".pem")
	pubPath  := filepath.Join(keysDir, name+".pub.pem")

	if fileExists(privPath) {
		return fmt.Errorf("key %q already exists at %s\n  Delete it first if you want to regenerate", name, privPath)
	}

	pub, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		return fmt.Errorf("key generation failed: %w", err)
	}

	// Save private key
	privBlock := &pem.Block{
		Type:  "ED25519 PRIVATE KEY",
		Bytes: []byte(priv),
	}
	if err := os.WriteFile(privPath, pem.EncodeToMemory(privBlock), 0600); err != nil {
		return fmt.Errorf("saving private key: %w", err)
	}

	// Save public key
	pubBlock := &pem.Block{
		Type:  "ED25519 PUBLIC KEY",
		Bytes: []byte(pub),
	}
	if err := os.WriteFile(pubPath, pem.EncodeToMemory(pubBlock), 0644); err != nil {
		return fmt.Errorf("saving public key: %w", err)
	}

	ui.Success(fmt.Sprintf("Generated key pair: %s", name))
	fmt.Println()
	ui.Note(fmt.Sprintf("  Private key: %s  (keep secret)", privPath))
	ui.Note(fmt.Sprintf("  Public key:  %s", pubPath))
	fmt.Println()
	ui.Info("Add your public key to tsuki-keys.json with:")
	fmt.Printf("\n  tsuki-dk key export %s\n\n", name)

	return nil
}

func exportPublicKey(name string) error {
	keysDir := tsukiKeysDir()
	pubPath := filepath.Join(keysDir, name+".pub.pem")

	data, err := os.ReadFile(pubPath)
	if err != nil {
		return fmt.Errorf("public key %q not found at %s\n  Run: tsuki-dk key generate %s", name, pubPath, name)
	}

	block, _ := pem.Decode(data)
	if block == nil {
		return fmt.Errorf("invalid PEM in %s", pubPath)
	}

	b64 := base64.StdEncoding.EncodeToString(block.Bytes)
	fmt.Printf("\nAdd to tsuki-keys.json:\n\n")
	fmt.Printf("  %q: \"ed25519:%s\"\n\n", name, b64)
	return nil
}

func listKeys() error {
	keysDir := tsukiKeysDir()
	entries, err := os.ReadDir(keysDir)
	if os.IsNotExist(err) {
		ui.Note("No keys found.")
		ui.Info("Run 'tsuki-dk key generate <n>' to create one")
		return nil
	}
	if err != nil {
		return err
	}

	fmt.Println()
	ui.SectionTitle("Signing keys")
	fmt.Println()
	for _, e := range entries {
		if filepath.Ext(e.Name()) == ".pem" && !strings.HasPrefix(e.Name(), ".") {
			name := e.Name()
			if len(name) > 8 && name[len(name)-8:] == ".pub.pem" {
				// skip pub files in main listing
				continue
			}
			keyName := name[:len(name)-4] // strip .pem
			pub := ""
			if fileExists(filepath.Join(keysDir, keyName+".pub.pem")) {
				pub = " (public key available)"
			}
			fmt.Printf("  %s%s\n", keyName, pub)
		}
	}
	fmt.Println()
	return nil
}

func tsukiKeysDir() string {
	home, _ := os.UserHomeDir()
	return filepath.Join(home, ".tsuki", "keys")
}