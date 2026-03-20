package cli

import (
	"fmt"

	"github.com/spf13/cobra"
)

// ── webkit — próximamente ─────────────────────────────────────────────────────
//
//	tsuki webkit está en desarrollo. Cuando esté listo permitirá compilar
//	componentes JSX → HTML/CSS/JS embebidos en ESP8266/ESP32.

func newWebkitCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "webkit",
		Short: "tsuki-webkit — JSX → HTML/CSS/JS para ESP8266/ESP32 (próximamente)",
		Long: `tsuki-webkit está en desarrollo.

Permitirá compilar componentes JSX en paneles de control HTML que se sirven
directamente desde tu ESP8266 o ESP32 a través de WiFi, sin dependencias externas.

  Importaciones compatibles (app.jsx):
    import { Api, Json, Serial } from 'tsuki-webkit'

Esta función estará disponible en una próxima versión de tsuki.
Más info: https://github.com/s7lver2/tsuki
`,
		RunE: func(cmd *cobra.Command, args []string) error {
			fmt.Println()
			fmt.Println("  ⏳  tsuki-webkit — próximamente")
			fmt.Println()
			fmt.Println("  Esta funcionalidad está en desarrollo activo.")
			fmt.Println("  Compilará componentes JSX → HTML/CSS/JS embebidos")
			fmt.Println("  para ESP8266/ESP32 sin dependencias externas.")
			fmt.Println()
			fmt.Println("  Más info: https://github.com/s7lver2/tsuki")
			fmt.Println()
			return nil
		},
	}

	// Subcomandos stub — evitan "unknown command" si el usuario los llama directamente
	for _, sub := range []string{"build", "check", "init", "info", "preview"} {
		name := sub
		cmd.AddCommand(&cobra.Command{
			Use:   name,
			Short: fmt.Sprintf("%s — próximamente", name),
			RunE: func(cmd *cobra.Command, args []string) error {
				fmt.Println()
				fmt.Printf("  ⏳  tsuki webkit %s — próximamente\n", name)
				fmt.Println()
				fmt.Println("  tsuki-webkit está en desarrollo y aún no está disponible.")
				fmt.Println("  Más info: https://github.com/s7lver2/tsuki")
				fmt.Println()
				return nil
			},
		})
	}

	return cmd
}
