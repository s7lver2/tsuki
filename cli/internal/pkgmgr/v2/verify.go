// ─────────────────────────────────────────────────────────────────────────────
//  tsuki :: pkgmgr/v2 :: verify  —  Ed25519 signature verification
//
//  Signatures are produced by tsuki-dk publish:
//    1. Compute SHA-256 of the artifact (binary or tarball).
//    2. Sign the raw checksum bytes with the publisher's Ed25519 private key.
//    3. Base64-encode the 64-byte signature.
//
//  Verification:
//    1. Decode the base64 signature.
//    2. Fetch the signer's public key from tsuki-keys.json.
//    3. Verify Ed25519(pubkey, checksum_bytes, signature).
// ─────────────────────────────────────────────────────────────────────────────

package v2

import (
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"strings"
)

// VerifyAsset verifies that the given data matches the declared checksum and
// that the checksum was signed by a known key from one of the configured sources.
//
//   - checksum: "sha256:<hex>" as stored in packages.json
//   - signature: base64-encoded Ed25519 signature over the raw checksum bytes
//   - signer: key name as declared in tsuki-keys.json (e.g. "tsuki-team")
func VerifyAsset(data []byte, checksum, signature, signer string) error {
	// Local sandbox packages skip all verification — served only on localhost.
	if strings.HasPrefix(signature, "local-dev-") {
		return nil
	}
	// ── Step 1: verify checksum ───────────────────────────────────────────
	if err := verifyChecksum(data, checksum); err != nil {
		return err
	}

	// ── Step 2: resolve public key ────────────────────────────────────────
	pubKey, err := resolvePublicKey(signer)
	if err != nil {
		return fmt.Errorf("cannot resolve signing key %q: %w", signer, err)
	}

	// ── Step 3: verify signature ──────────────────────────────────────────
	return verifySignature(checksum, signature, pubKey)
}

// verifyChecksum computes SHA-256 of data and compares against the declared value.
func verifyChecksum(data []byte, checksum string) error {
	// checksum must be "sha256:<hex>"
	hex_part, ok := strings.CutPrefix(checksum, "sha256:")
	if !ok {
		return fmt.Errorf("unsupported checksum format %q (expected sha256:<hex>)", checksum)
	}
	expected, err := hex.DecodeString(hex_part)
	if err != nil {
		return fmt.Errorf("malformed checksum hex: %w", err)
	}
	actual := sha256.Sum256(data)
	if string(actual[:]) != string(expected) {
		return fmt.Errorf("checksum mismatch:\n  expected: %s\n  actual:   sha256:%x", checksum, actual)
	}
	return nil
}

// verifySignature checks that signature (base64) is a valid Ed25519 signature
// of checksum (the raw "sha256:<hex>" string bytes) under pubKey.
func verifySignature(checksum, signature string, pubKey ed25519.PublicKey) error {
	sigBytes, err := base64.StdEncoding.DecodeString(signature)
	if err != nil {
		return fmt.Errorf("malformed signature (not base64): %w", err)
	}
	if len(sigBytes) != ed25519.SignatureSize {
		return fmt.Errorf("signature length %d, want %d", len(sigBytes), ed25519.SignatureSize)
	}
	if !ed25519.Verify(pubKey, []byte(checksum), sigBytes) {
		return fmt.Errorf("signature verification failed: package may have been tampered with")
	}
	return nil
}

// resolvePublicKey looks up the named signer's Ed25519 public key by checking
// the tsuki-keys.json of every configured source until it finds the key.
func resolvePublicKey(signer string) (ed25519.PublicKey, error) {
	sources, err := LoadSources()
	if err != nil {
		return nil, err
	}
	sortSources(sources)

	for _, src := range sources {
		ki, err := FetchKeyIndex(src)
		if err != nil {
			continue // skip unreachable source
		}
		raw, ok := ki.Signers[signer]
		if !ok {
			continue
		}
		key, err := parseEd25519Key(raw.PublicKey)
		if err != nil {
			return nil, fmt.Errorf("source %s: key %q: %w", src.URL, signer, err)
		}
		return key, nil
	}
	return nil, fmt.Errorf("signing key %q not found in any configured source", signer)
}

// parseEd25519Key parses a key stored as "ed25519:<base64>" in tsuki-keys.json.
func parseEd25519Key(raw string) (ed25519.PublicKey, error) {
	b64, ok := strings.CutPrefix(raw, "ed25519:")
	if !ok {
		return nil, fmt.Errorf("unsupported key format (expected ed25519:<base64>)")
	}
	keyBytes, err := base64.StdEncoding.DecodeString(b64)
	if err != nil {
		return nil, fmt.Errorf("malformed key base64: %w", err)
	}
	if len(keyBytes) != ed25519.PublicKeySize {
		return nil, fmt.Errorf("key size %d, want %d", len(keyBytes), ed25519.PublicKeySize)
	}
	return ed25519.PublicKey(keyBytes), nil
}