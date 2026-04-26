package screens

import (
	"strings"
	"testing"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"

	"github.com/santifer/career-ops/dashboard/internal/model"
	"github.com/santifer/career-ops/dashboard/internal/theme"
)

func TestWithReloadedDataPreservesStateAndSelection(t *testing.T) {
	initialApps := []model.CareerApplication{
		{
			Company:    "Acme",
			Role:       "Backend Engineer",
			Status:     "Evaluated",
			Score:      4.2,
			ReportPath: "reports/001-acme.md",
		},
		{
			Company:    "Beta",
			Role:       "Platform Engineer",
			Status:     "Applied",
			Score:      4.6,
			ReportPath: "reports/002-beta.md",
		},
	}

	pm := NewPipelineModel(
		theme.NewTheme("catppuccin-mocha"),
		initialApps,
		model.PipelineMetrics{Total: len(initialApps)},
		"..",
		120,
		40,
	)
	pm.sortMode = sortCompany
	pm.activeTab = 0
	pm.viewMode = "flat"
	pm.applyFilterAndSort()
	pm.cursor = 1
	pm.reportCache["reports/002-beta.md"] = reportSummary{tldr: "cached"}

	refreshedApps := []model.CareerApplication{
		initialApps[0],
		initialApps[1],
		{
			Company:    "Gamma",
			Role:       "AI Engineer",
			Status:     "Interview",
			Score:      4.8,
			ReportPath: "reports/003-gamma.md",
		},
	}

	reloaded := pm.WithReloadedData(refreshedApps, model.PipelineMetrics{Total: len(refreshedApps)})

	if reloaded.sortMode != sortCompany {
		t.Fatalf("expected sort mode %q, got %q", sortCompany, reloaded.sortMode)
	}
	if reloaded.viewMode != "flat" {
		t.Fatalf("expected view mode to stay flat, got %q", reloaded.viewMode)
	}
	if got := len(reloaded.filtered); got != 3 {
		t.Fatalf("expected 3 filtered apps after refresh, got %d", got)
	}
	if app, ok := reloaded.CurrentApp(); !ok || app.ReportPath != "reports/002-beta.md" {
		t.Fatalf("expected selection to stay on beta app, got %+v (ok=%v)", app, ok)
	}
	if reloaded.reportCache["reports/002-beta.md"].tldr != "cached" {
		t.Fatal("expected cached report summaries to survive refresh")
	}
}

func TestRenderAppLineIncludesDateColumn(t *testing.T) {
	pm := NewPipelineModel(
		theme.NewTheme("catppuccin-mocha"),
		nil,
		model.PipelineMetrics{},
		"..",
		120,
		40,
	)

	line := pm.renderAppLine(model.CareerApplication{
		Date:    "2026-04-13",
		Company: "Anthropic",
		Role:    "Forward Deployed Engineer",
		Status:  "Applied",
		Score:   4.5,
	}, false)

	if !strings.Contains(line, "2026-04-13") {
		t.Fatalf("expected rendered line to include date column, got %q", line)
	}
}

func TestRenderAppLineFitsCompactWidth(t *testing.T) {
	pm := NewPipelineModel(
		theme.NewTheme("catppuccin-mocha"),
		nil,
		model.PipelineMetrics{},
		"..",
		72,
		24,
	)

	line := pm.renderAppLine(model.CareerApplication{
		Date:    "2026-04-13",
		Company: "Very Long Company Name Incorporated",
		Role:    "Principal Forward Deployed AI Transformation Engineer for Enterprise Automation",
		Status:  "Interview",
		Score:   4.7,
	}, true)

	if got := lipgloss.Width(line); got > 72 {
		t.Fatalf("expected compact row to fit width 72, got width %d: %q", got, line)
	}
}

func TestRenderPreviewWrapsLongSummaryToScreenWidth(t *testing.T) {
	app := model.CareerApplication{
		Company:    "Acme",
		Role:       "AI Engineer",
		Status:     "Evaluated",
		Score:      4.3,
		ReportPath: "reports/001-acme.md",
	}
	pm := NewPipelineModel(
		theme.NewTheme("catppuccin-mocha"),
		[]model.CareerApplication{app},
		model.PipelineMetrics{Total: 1},
		"..",
		64,
		24,
	)
	pm.reportCache[app.ReportPath] = reportSummary{
		tldr: "This is a long summary that should wrap cleanly instead of pushing the preview outside the terminal viewport and hiding the next controls.",
		comp: "USD 180k-220k",
	}

	for _, line := range strings.Split(pm.renderPreview(), "\n") {
		if got := lipgloss.Width(line); got > 64 {
			t.Fatalf("expected preview line to fit width 64, got width %d: %q", got, line)
		}
	}
}

func TestStatusPickerStartsOnCurrentStatus(t *testing.T) {
	pm := NewPipelineModel(
		theme.NewTheme("catppuccin-mocha"),
		[]model.CareerApplication{{
			Company: "Acme",
			Role:    "AI Engineer",
			Status:  "Interview",
			Score:   4.3,
		}},
		model.PipelineMetrics{Total: 1},
		"..",
		100,
		30,
	)

	updated, _ := pm.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'c'}})

	if !updated.statusPicker {
		t.Fatal("expected status picker to open")
	}
	if statusOptions[updated.statusCursor] != "Interview" {
		t.Fatalf("expected picker to start on Interview, got %q", statusOptions[updated.statusCursor])
	}
}

func TestPipelineViewFitsCompactViewport(t *testing.T) {
	pm := NewPipelineModel(
		theme.NewTheme("catppuccin-mocha"),
		[]model.CareerApplication{
			{
				Date:    "2026-04-13",
				Company: "Very Long Company Name Incorporated",
				Role:    "Principal Forward Deployed AI Transformation Engineer for Enterprise Automation",
				Status:  "Interview",
				Score:   4.7,
			},
			{
				Date:    "2026-04-14",
				Company: "Acme",
				Role:    "AI Engineer",
				Status:  "Applied",
				Score:   4.1,
			},
		},
		model.PipelineMetrics{
			Total:      2,
			AvgScore:   4.4,
			WithPDF:    1,
			Actionable: 2,
			ByStatus:   map[string]int{"interview": 1, "applied": 1},
		},
		"..",
		72,
		24,
	)

	parts := map[string]string{
		"header":  pm.renderHeader(),
		"tabs":    pm.renderTabs(),
		"metrics": pm.renderMetrics(),
		"sort":    pm.renderSortBar(),
		"body":    pm.renderBody(),
		"preview": pm.renderPreview(),
		"help":    pm.renderHelp(),
	}
	for name, part := range parts {
		for _, line := range strings.Split(part, "\n") {
			if got := lipgloss.Width(line); got > 72 {
				t.Fatalf("expected %s line to fit width 72, got width %d: %q", name, got, line)
			}
		}
	}

	for _, line := range strings.Split(pm.View(), "\n") {
		if got := lipgloss.Width(line); got > 72 {
			t.Fatalf("expected pipeline view line to fit width 72, got width %d: %q", got, line)
		}
	}
}

func TestRenderSplitLineHonorsRequestedWidth(t *testing.T) {
	line := renderSplitLine(
		"CAREER PIPELINE",
		"2 offers | Avg 4.4/5",
		68,
		lipgloss.NewStyle(),
		lipgloss.NewStyle(),
	)

	if got := lipgloss.Width(line); got != 68 {
		t.Fatalf("expected split line width 68, got %d: %q", got, line)
	}
}

func TestPipelineHeaderHonorsModelWidth(t *testing.T) {
	pm := NewPipelineModel(
		theme.NewTheme("catppuccin-mocha"),
		nil,
		model.PipelineMetrics{Total: 2, AvgScore: 4.4},
		"..",
		72,
		24,
	)

	if got := lipgloss.Width(pm.renderHeader()); got != 72 {
		t.Fatalf("expected header width 72, got %d: %q", got, pm.renderHeader())
	}
}

func TestPipelineViewShowsColumnHeaders(t *testing.T) {
	pm := NewPipelineModel(
		theme.NewTheme("catppuccin-mocha"),
		[]model.CareerApplication{{
			Date:    "2026-04-13",
			Company: "Acme",
			Role:    "AI Engineer",
			Status:  "Applied",
			Score:   4.1,
		}},
		model.PipelineMetrics{Total: 1},
		"..",
		100,
		30,
	)

	view := pm.View()
	for _, want := range []string{"Score", "Date", "Company", "Role", "Status"} {
		if !strings.Contains(view, want) {
			t.Fatalf("expected pipeline view to include column header %q, got %q", want, view)
		}
	}
}
