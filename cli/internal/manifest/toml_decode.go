package manifest

import (
	"github.com/BurntSushi/toml"
)

// decodeTOML unmarshals TOML data into v using BurntSushi/toml.
func decodeTOML(data []byte, v interface{}) error {
	_, err := toml.Decode(string(data), v)
	return err
}