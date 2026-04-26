package screens

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/santifer/career-ops/dashboard/internal/theme"
)

func TestViewerHeaderShowsLinePosition(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "report.md")
	if err := os.WriteFile(path, []byte("# Report\n\nBody\n"), 0644); err != nil {
		t.Fatal(err)
	}

	vm := NewViewerModel(theme.NewTheme("catppuccin-mocha"), path, "Acme - AI Engineer", 80, 24)
	header := vm.renderHeader()

	if !strings.Contains(header, "1/4") {
		t.Fatalf("expected header to show line position 1/4, got %q", header)
	}
}
